import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { z } from "zod";
import { logger } from "@argon/core";
import { useConfig } from "@/store/system/remoteConfig";

// Self-hosted / SaaS / enterprise instance routing.
//
// The whole client funnels every endpoint through useConfig() (apiEndpoint/cdnEndpoint/...), and the
// RPC client is a computed of cfg.apiEndpoint — so re-pointing the app at another Argon instance is
// just a matter of swapping those overrides. This store owns the "active instance manifest": a typed,
// baked-in default for the official argon.gl instance, replaced at runtime by fetching a manifest from
// a self-hosted server or a managed (enterprise) instance resolved from the user's email domain.

const PERSIST_KEY = "argon_instance";

// Keep these field names in sync with the server DTOs in
// server/src/Argon.Core/Features/Discovery/DiscoveryDtos.cs (serialized camelCase).
export const instanceManifestSchema = z.object({
  schemaVersion: z.number(),
  instance: z.object({
    id: z.string(),
    name: z.string(),
    // Unknown future kinds degrade to "selfhosted" rather than failing the whole manifest.
    kind: z.enum(["official", "selfhosted", "managed"]).catch("selfhosted"),
  }),
  // Only what the client consumes. The voice/WebRTC endpoint is negotiated per-connection by the
  // server (it arrives with the call grant), and SignalR is derived from `api` (`${api}/w`) — so
  // neither belongs in the manifest.
  endpoints: z.object({
    api: z.string().url(),
    cdn: z.string().url(),
  }),
  branding: z
    .object({
      displayName: z.string(),
      logoUrl: z.string().nullish(),
      accentColor: z.string().nullish(),
    })
    .default({ displayName: "Argon" }),
  features: z
    .object({
      registrationEnabled: z.boolean().default(true),
      qrLoginEnabled: z.boolean().default(true),
      ssoUrl: z.string().nullish(),
    })
    .default({}),
  legal: z
    .object({
      termsUrl: z.string().nullish(),
      privacyUrl: z.string().nullish(),
    })
    .default({}),
  minClientVersion: z.string().nullish(),
});

export type InstanceManifest = z.infer<typeof instanceManifestSchema>;
export type InstanceKind = InstanceManifest["instance"]["kind"];

// The official baseline — used at boot with NO network fetch. Mirrors the prior hardcoded endpoints.
export const DEFAULT_MANIFEST: InstanceManifest = {
  schemaVersion: 1,
  instance: { id: "argon-official", name: "Argon", kind: "official" },
  endpoints: {
    api: "https://api.argon.gl",
    cdn: "https://cdn.argon.gl",
  },
  branding: { displayName: "Argon", accentColor: "#3B82F6" },
  features: { registrationEnabled: true, qrLoginEnabled: true, ssoUrl: null },
  legal: {},
  minClientVersion: null,
};

export type InstanceErrorKind =
  | "unreachable" //   network error / timeout / DNS
  | "not-argon" //     non-2xx / HTML / non-JSON body
  | "invalid-schema" // valid JSON but not a manifest
  | "version-gate" //  client older than minClientVersion
  | "insecure-http"; // http:// for a non-localhost host

export class InstanceError extends Error {
  constructor(public kind: InstanceErrorKind, message?: string) {
    super(message ?? kind);
    this.name = "InstanceError";
  }
}

export type ResolveKind = "official" | "managed" | "unknown";
export interface ResolveResult {
  kind: ResolveKind;
  instanceUrl?: string | null;
}

export const useInstance = defineStore("instance", () => {
  const cfg = useConfig();

  const active = ref<InstanceManifest>(DEFAULT_MANIFEST);
  const isOfficial = computed(() => active.value.instance.kind === "official");
  const branding = computed(() => active.value.branding);
  const features = computed(() => active.value.features);

  // Push the manifest's endpoints into the global config overrides so the rest of the app re-points.
  // For a non-official instance we force the dev endpoint selector to "live" so our apiEndpoint
  // override wins over the live/dev/local selector (see remoteConfig.apiEndpoint).
  function pushOverrides(m: InstanceManifest) {
    cfg.setOverride("apiEndpoint", m.endpoints.api);
    cfg.setOverride("cdnEndpoint", m.endpoints.cdn);
    // webRtcEndpoint is intentionally NOT set here: the voice endpoint is granted per-connection
    // by the server, so re-pointing `api` is enough (calls automatically target the new instance).
    if (m.instance.kind !== "official") localStorage.setItem("api_endpoint", "live");
  }

  // Re-point endpoints from a manifest object WITHOUT persisting or reloading. Used at boot by the
  // accounts layer, where the active account's manifest is the source of truth.
  function applyManifestObject(m: InstanceManifest) {
    active.value = m;
    pushOverrides(m);
  }

  // Synchronous boot restore (no network): a previously-applied alternate instance is re-pointed
  // before the first RPC fires. Falls back to the official default on any parse failure.
  // No-op when a multi-account active pointer exists — accountsStore drives endpoints from the
  // active account's manifest instead of the legacy single `argon_instance` key.
  (function restore() {
    if (localStorage.getItem("argon_active_account")) return;
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) {
        pushOverrides(DEFAULT_MANIFEST);
        return;
      }
      const parsed = instanceManifestSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        logger.warn("Discarding invalid persisted instance manifest");
        localStorage.removeItem(PERSIST_KEY);
        pushOverrides(DEFAULT_MANIFEST);
        return;
      }
      active.value = parsed.data;
      pushOverrides(parsed.data);
    } catch (e) {
      logger.warn("Failed to restore instance manifest, using official default", e);
      localStorage.removeItem(PERSIST_KEY);
      pushOverrides(DEFAULT_MANIFEST);
    }
  })();

  function normalizeBaseUrl(input: string): string {
    let v = (input ?? "").trim();
    if (!v) throw new InstanceError("unreachable", "Empty address");
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`; // bare host → assume https
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      throw new InstanceError("unreachable", "Invalid address");
    }
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "http:" && !isLocal) throw new InstanceError("insecure-http");
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new InstanceError("unreachable", "Unsupported scheme");
    return `${url.protocol}//${url.host}`; // strip path/trailing slash
  }

  function satisfiesMinVersion(min: string): boolean {
    const cur = (typeof window !== "undefined" && (window as any).ui_version) || "0.0.0";
    return compareSemver(String(cur), min) >= 0;
  }

  // Fetch + validate a manifest from a server base URL. Throws a typed InstanceError on every failure.
  async function fetchManifest(baseUrl: string): Promise<InstanceManifest> {
    const base = normalizeBaseUrl(baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`${base}/.well-known/argon-instance.json`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      throw new InstanceError("unreachable");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new InstanceError("not-argon", `HTTP ${res.status}`);

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new InstanceError("not-argon", "Response was not JSON");
    }

    const parsed = instanceManifestSchema.safeParse(json);
    if (!parsed.success) throw new InstanceError("invalid-schema");

    const m = parsed.data;
    if (m.minClientVersion && !satisfiesMinVersion(m.minClientVersion))
      throw new InstanceError("version-gate");
    return m;
  }

  // Ask the main directory (the currently-configured API) which instance owns an email's domain.
  // Always fail-OPEN to "official" so a directory outage never blocks sign-in.
  async function resolveByEmail(email: string): Promise<ResolveResult> {
    const apiBase = cfg.apiEndpoint.replace(/\/+$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(`${apiBase}/api/discovery/resolve?email=${encodeURIComponent(email)}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
      });
      if (!res.ok) return { kind: "official" };
      const json: any = await res.json();
      if (json && (json.kind === "managed" || json.kind === "official" || json.kind === "unknown"))
        return { kind: json.kind, instanceUrl: json.instanceUrl ?? null };
      return { kind: "official" };
    } catch {
      return { kind: "official" };
    } finally {
      clearTimeout(timer);
    }
  }

  // Re-point the app at a manifest. Pre-login this is fully reactive (no reload) so the user's typed
  // email and the form animations survive. When ALREADY signed in, tokens are per-instance, so we
  // hard-reset: drop the session, clear per-instance caches, and reload into the new instance.
  async function applyInstance(m: InstanceManifest): Promise<void> {
    pushOverrides(m);
    active.value = m;
    if (m.instance.kind === "official") localStorage.removeItem(PERSIST_KEY);
    else localStorage.setItem(PERSIST_KEY, JSON.stringify(m));

    const { useAuthStore } = await import("@/store/auth/authStore");
    const auth = useAuthStore();
    if (auth.isAuthenticated) {
      auth.logout();
      localStorage.removeItem("rft");
      const { pruneIndexDb, pruneBuckets, pruneCache } = await import("@/store/system/fileStorage");
      await pruneIndexDb();
      await pruneBuckets();
      await pruneCache();
      location.reload();
    }
  }

  async function resetToDefault(): Promise<void> {
    await applyInstance(DEFAULT_MANIFEST);
  }

  return {
    active,
    isOfficial,
    branding,
    features,
    fetchManifest,
    resolveByEmail,
    applyInstance,
    applyManifestObject,
    resetToDefault,
  };
});

// Numeric semver compare, ignoring pre-release tags. Returns -1/0/1.
function compareSemver(a: string, b: string): number {
  const pa = a.split("-")[0].split(".").map(n => parseInt(n, 10) || 0);
  const pb = b.split("-")[0].split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
