/**
 * The two ways the browser build refuses to start, drawn before Vue mounts.
 *
 * Both cases are decided by facts that will not change while the page is open — the browser is the
 * browser, the phone is a phone — so there is nothing for the app to react to and no reason to boot
 * it. Rendering here rather than as a route also means the screen still appears when the reason we
 * are refusing is exactly the thing the app would need in order to render a route.
 *
 * Plain DOM and inline styles on purpose: no framework, no store, no stylesheet load order to get
 * right. Text is looked up straight out of the message bundles, which are a static import.
 */

import { coreMessages } from "@argon/i18n";
import { readPersistedValue } from "@argon/storage";
import { DOWNLOAD_URL, isMobileLayout, isWeb } from "@/lib/platform";
import { isInsecureContext, missingCapabilities, type CapabilityCheck } from "@/lib/browserSupport";

function translator(): (key: string, fallback: string) => string {
  let locale: string;
  try {
    locale = readPersistedValue<string>("locale", "en");
  } catch {
    locale = "en";
  }
  // The bundles are not flat all the way down (a few keys hold nested objects), and this gate only
  // ever asks for leaf strings — so anything that is not one falls through to the next source.
  const bundles = coreMessages as unknown as Record<string, Record<string, unknown>>;
  const bundle = bundles[locale] ?? bundles.en;
  const pick = (from: Record<string, unknown> | undefined, key: string) =>
    typeof from?.[key] === "string" ? (from[key] as string) : undefined;
  return (key, fallback) => pick(bundle, key) ?? pick(bundles.en, key) ?? fallback;
}

const ARGON_MARK = `<svg viewBox="0 0 128 128" width="56" height="56" aria-hidden="true"><path fill="#3B82F6" d="M114.54,88.82c5.35-2.75,9.96-6.72,13.46-11.53c-4.67-3.14-9.86-5.56-15.4-7.09c0.01-24.5-6.29-48.6-18.25-69.73c-7.96,8.45-14.3,18.49-18.62,29.31c-7.66-1.22-15.65-1.06-23.27,0.31C48.13,19.15,41.74,9.02,33.71,0.47C21.76,21.62,15.45,45.7,15.46,70.2c-5.54,1.53-10.73,3.95-15.4,7.09c3.49,4.82,8.1,8.78,13.46,11.53c-3.64,2.85-6.74,6.37-9.14,10.33c5.87,4.32,12.67,7.48,20.05,9.09c19.68,25.4,59.51,25.41,79.2,0c7.38-1.61,14.18-4.78,20.05-9.09C121.28,95.19,118.18,91.68,114.54,88.82z M23.7,68.22c0,0,4.13-2.07,12.4-2.07c8.27,0,19.64,11.37,19.64,11.37s-8.27,6.2-19.64,9.3C32.11,87.91,26.8,77.52,23.7,68.22z M64,98.19c-5.71,0-10.33-4.13-10.33-12.4c1.04-0.35,2.16-0.62,3.3-0.85l3,6.02l1.21-6.61c1.9-0.14,3.84-0.14,5.75,0.01l1.22,6.65l3.01-6.05c1.1,0.23,2.17,0.49,3.18,0.82C74.33,94.05,69.71,98.19,64,98.19z M92.99,86.03c-11.37-3.1-19.63-9.3-19.63-9.3s11.37-11.37,19.63-11.37s12.4,2.07,12.4,2.07C102.29,76.73,96.98,87.12,92.99,86.03z"/></svg>`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function render(body: string): void {
  const host = document.getElementById("app") ?? document.body;
  host.innerHTML = `
    <div class="boot-gate">
      <div class="boot-gate-card">
        ${ARGON_MARK}
        ${body}
      </div>
    </div>
    <style>
      html, body { background: #0b0b0f; }
      .boot-gate {
        position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
        padding: 24px; overflow: auto; color: #e7e7ea;
        font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background:
          radial-gradient(120% 90% at 12% 0%, rgba(59,130,246,0.16) 0%, rgba(59,130,246,0) 55%),
          radial-gradient(110% 80% at 92% 8%, rgba(139,92,246,0.14) 0%, rgba(139,92,246,0) 55%),
          #0b0b0f;
      }
      /* The app's own stylesheet is loaded by now and its reset makes every svg a block element,
         so the mark centres itself rather than relying on the card's text-align. */
      .boot-gate-card svg { display: block; margin: 0 auto; }
      .boot-gate-card {
        max-width: 460px; width: 100%; text-align: center;
        border: 1px solid rgba(255,255,255,0.08); border-radius: 16px;
        background: rgba(255,255,255,0.035); padding: 32px 28px;
        box-shadow: 0 24px 70px rgba(0,0,0,0.55);
      }
      .boot-gate h1 { margin: 18px 0 8px; font-size: 20px; font-weight: 700; line-height: 1.35; }
      .boot-gate p { margin: 0; font-size: 14px; line-height: 1.6; color: #a1a1ad; }
      .boot-gate a.cta {
        display: inline-block; margin-top: 24px; padding: 10px 20px; border-radius: 10px;
        background: #3B82F6; color: #fff; font-size: 14px; font-weight: 600; text-decoration: none;
      }
      .boot-gate a.cta:hover { background: #2f74e0; }
    </style>`;
}

/** "This browser can't run Argon", with the specific pieces it is missing. */
function renderUnsupportedBrowser(missing: CapabilityCheck[], insecure: boolean): void {
  const t = translator();
  const reason = insecure
    ? t("boot_insecure_context_desc", "Argon needs a secure (https) connection to run.")
    : t("boot_unsupported_browser_desc", "Your browser is missing features Argon needs. Update it, switch to a recent Chrome, Edge or another Chromium-based browser, or use the desktop app.");
  // Named in the console, not on the screen: "WebSocket Streams" tells a user nothing they can act
  // on — the advice is the same whichever one is missing — while support still needs to know which.
  if (missing.length)
    console.warn("[argon] unsupported browser, missing:", missing.map((m) => m.label).join(", "));

  render(`
    <h1>${escapeHtml(insecure ? t("boot_insecure_context_title", "Insecure connection") : t("boot_unsupported_browser_title", "This browser isn't supported"))}</h1>
    <p>${escapeHtml(reason)}</p>
    <a class="cta" href="${DOWNLOAD_URL}">${escapeHtml(t("boot_get_desktop_app", "Get Argon for desktop"))}</a>`);
}

/** "Use the app instead", for phone-shaped browsers. */
function renderMobileUnsupported(): void {
  const t = translator();
  render(`
    <h1>${escapeHtml(t("boot_mobile_title", "Argon for web needs a bigger screen"))}</h1>
    <p>${escapeHtml(t("boot_mobile_desc", "The web app is built for desktop. On a phone or tablet, use the Argon mobile app instead."))}</p>
    <a class="cta" href="${DOWNLOAD_URL}">${escapeHtml(t("boot_get_mobile_app", "Get the Argon app"))}</a>`);
}

// ── the decision ─────────────────────────────────────────────────────────────────────────────────

export type BootBlock =
  | { reason: "mobile" }
  | { reason: "insecure" }
  | { reason: "capabilities"; missing: CapabilityCheck[] };

/**
 * Why this page must not boot the app, or null when it may.
 *
 * Only ever answers for the browser build — the desktop host ships its own runtime and is a phone
 * for nobody.
 */
export function evaluateBootGate(): BootBlock | null {
  if (!isWeb) return null;
  if (isMobileLayout()) return { reason: "mobile" };
  if (isInsecureContext()) return { reason: "insecure" };
  const missing = missingCapabilities();
  if (missing.length > 0) return { reason: "capabilities", missing };
  return null;
}

/** Draw the screen that belongs to a block returned by `evaluateBootGate`. */
export function renderBootGate(block: BootBlock): void {
  if (block.reason === "mobile") {
    renderMobileUnsupported();
    return;
  }
  renderUnsupportedBrowser(
    block.reason === "capabilities" ? block.missing : [],
    block.reason === "insecure",
  );
}
