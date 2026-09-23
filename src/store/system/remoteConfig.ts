import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { logger } from "@argon/core";
import { z } from "zod";

export const useConfig = defineStore("config", () => {

  const overrides = ref<{ [key: string]: string | boolean | number }>({
   // apiEndpoint: 'https://localhost:5001'
   apiEndpoint: "https://api.argon.gl",
   // dev-api, not dev.api: the stand is served off a single-label host (see the dev IngressRoute),
   // and the dotted spelling resolves nowhere at all.
   apiDevEndpoint: "https://dev-api.argon.gl",
   // 5002 is what Kestrel:Argon:Port binds on the `dev` role — see deploy/dev/README.md. HTTPS and
   // not HTTP: a page served over TLS cannot call a plain-text API, and OpenIddict refuses one too.
   apiLocalEndpoint: "https://localhost:5002",

   // Where the browser build sends the user to sign in. One per API, because an Aegis only knows
   // about the applications registered in its own database: a token from the live identity server
   // means nothing to a server running on this machine, and the exchange refuses it.
   //
   // A local stand runs the identity server as its own process, on its own port, exactly as the
   // deployment does. It has to: `HostHooksFeature` maps a version document at `/` on every role
   // that does not serve a site there, and the co-hosted `dev` role deliberately serves no widget —
   // so the sign-in page is unreachable while Aegis shares a port with the API.
   //
   //   dotnet run --project src/Argon.Api -- --role aegis     (Kestrel__Argon__Port=5003)
   aegisEndpoint: "https://aegis.argon.gl",
   aegisDevEndpoint: "https://dev-aegis.argon.gl",
   aegisLocalEndpoint: "https://localhost:5003",

   // The OAuth client the browser build signs in as. Overridable because it is a row in the identity
   // server's database rather than a constant: a local stand issues its own id when the application
   // is registered there, and it will not be this one.
   webClientId: "A37E7A1DB06E9610C9C0BD77C61A821B"
  });

  function setOverride(key: string, value: string | boolean | number) {
    logger.warn(`Overrided '${key}' with value '${value}'`);
    overrides.value[key] = value;
  }

  function removeOverride(key: string) {
    delete overrides.value[key];
  }

  function clearOverrides() {
    overrides.value = {};
  }

  function boolVal(key: string) {
    if (key in overrides.value) {
      return overrides.value[key] === true;
    }
    return false;
  }
  function stringVal(key: string) {
    if (key in overrides.value) {
      return String(overrides.value[key]);
    }
    throw new Error(key);
  }

  const isGenderEnabled = computed(() => boolVal("enabled_sex_field"));

  /** Which of the three stands this browser is pointed at. */
  const endpoint = computed<"live" | "dev" | "local">(() => {
    const selected = localStorage.getItem("api_endpoint");
    return selected === "dev" || selected === "local" ? selected : "live";
  });

  const apiEndpoint = computed(() => {
    if (endpoint.value === "dev") return stringVal("apiDevEndpoint");
    if (endpoint.value === "local") return stringVal("apiLocalEndpoint");
    return stringVal("apiEndpoint");
  });

  /**
   * The identity server that goes with {@link apiEndpoint}, and it has to be that one.
   *
   * An Aegis only knows the applications registered in its own database, and the exchange at
   * `/auth/web/session` only accepts a token its own identity server signed. Signing in at the live
   * Aegis and presenting the result to a server on this machine fails at the exchange, not at the
   * redirect, so the two selectors can never be set independently.
   */
  const aegisEndpoint = computed(() => {
    if (endpoint.value === "dev") return stringVal("aegisDevEndpoint");
    if (endpoint.value === "local") return stringVal("aegisLocalEndpoint");
    return stringVal("aegisEndpoint");
  });

  const webClientId = computed(() => stringVal("webClientId"));

  /**
   * Where the realtime stream reaches WebTransport, for the stand {@link apiEndpoint} points at, or
   * null when that stand advertises none (the stream then uses WebSocket only). Set from the
   * instance manifest for `live`; `dev` and `local` only when overridden by hand.
   */
  const webTransportEndpoint = computed<string | null>(() => {
    const key =
      endpoint.value === "dev"
        ? "webTransportDevEndpoint"
        : endpoint.value === "local"
          ? "webTransportLocalEndpoint"
          : "webTransportEndpoint";
    const value = overrides.value[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  });

  const cdnEndpoint = computed(() => stringVal("cdnEndpoint"));
  const webRtcEndpoint = computed(() => stringVal("webRtcEndpoint"));
  // Scheme-agnostic on purpose: a local stand serves plain HTTP unless it has been given a
  // certificate, and matching on "https://localhost:" quietly stopped recognising it as dev.
  const isDev = computed(
    () => endpoint.value !== "live" || /^https?:\/\/localhost(:|\/|$)/.test(apiEndpoint.value),
  );

  const scheme = z.object({
    cdnEndpoint: z
      .string()
      .describe("CDN Endpoint")
      .default(() => cdnEndpoint.value),
    apiEndpoint: z
      .string()
      .describe("API Endpoint")
      .default(() => apiEndpoint.value),
    webRtcEndpoint: z
      .string()
      .describe("WebRTC Endpoint")
      .default(() => webRtcEndpoint.value),
    enabled_sex_field: z.boolean().default(() => isGenderEnabled.value),
  });

  return {
    isGenderEnabled,
    endpoint,
    apiEndpoint,
    aegisEndpoint,
    webClientId,
    webTransportEndpoint,
    cdnEndpoint,
    webRtcEndpoint,
    scheme,
    setOverride,
    removeOverride,
    clearOverrides,
    isDev,
  };
});
