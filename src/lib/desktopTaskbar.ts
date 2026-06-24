import { watch } from "vue";
import { native } from "@argon/glue/native";
import { logger } from "@argon/core";
import { useSystemStore } from "@/store/system/systemStore";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useWindow } from "@/store/ui/windowStore";
import { useLocale } from "@/store/system/localeStore";

/**
 * Wires the Windows taskbar UX that the native host exposes (jump-list quick actions +
 * thumbnail-toolbar call controls). The host applies the actual Electron calls; this module
 * just feeds it localized labels / rendered icons and routes clicked actions back into the
 * stores. No-op outside the Windows desktop host.
 *
 * The unread overlay badge + attention flash are driven separately, from the notification
 * store, since they track unread state. See taskbarBadge.ts.
 */

// ── Lucide icon → PNG (same glyphs as the in-app call controls) ──────
type IconNode = [tag: string, attrs: Record<string, string | number>][];

// Copied verbatim from lucide-vue-next so the thumbbar matches MediaControls.vue 1:1.
const ICONS: Record<string, IconNode> = {
  mic: [
    ["path", { d: "M12 19v3" }],
    ["path", { d: "M19 10v2a7 7 0 0 1-14 0v-2" }],
    ["rect", { x: 9, y: 2, width: 6, height: 13, rx: 3 }],
  ],
  "mic-off": [
    ["path", { d: "M12 19v3" }],
    ["path", { d: "M15 9.34V5a3 3 0 0 0-5.68-1.33" }],
    ["path", { d: "M16.95 16.95A7 7 0 0 1 5 12v-2" }],
    ["path", { d: "M18.89 13.23A7 7 0 0 0 19 12v-2" }],
    ["path", { d: "m2 2 20 20" }],
    ["path", { d: "M9 9v3a3 3 0 0 0 5.12 2.12" }],
  ],
  headphones: [
    ["path", { d: "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" }],
  ],
  "headphone-off": [
    ["path", { d: "M21 14h-1.343" }],
    ["path", { d: "M9.128 3.47A9 9 0 0 1 21 12v3.343" }],
    ["path", { d: "m2 2 20 20" }],
    ["path", { d: "M20.414 20.414A2 2 0 0 1 19 21h-1a2 2 0 0 1-2-2v-3" }],
    ["path", { d: "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.636-6.364" }],
  ],
  "phone-off": [
    ["path", { d: "M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272" }],
    ["path", { d: "M22 2 2 22" }],
    ["path", { d: "M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473" }],
  ],
};

function buildSvg(node: IconNode): string {
  const children = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
      return `<${tag} ${a} />`;
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`
  );
}

const iconCache = new Map<string, string>();

function rasterize(key: string, size = 32): Promise<string> {
  const cached = iconCache.get(key);
  if (cached) return Promise.resolve(cached);
  return new Promise<string>((resolve, reject) => {
    const img = new Image(size, size);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(img, 0, 0, size, size);
      const url = canvas.toDataURL("image/png");
      iconCache.set(key, url);
      resolve(url);
    };
    img.onerror = (e) => reject(e);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(buildSvg(ICONS[key]));
  });
}

let initialized = false;

export function initDesktopTaskbar(): void {
  if (initialized) return;
  // Jump list + thumbnail toolbar are Windows-only; gate on the userAgent (the host bits are
  // unreliable — see the argon-host-bit-detection note).
  if (!argon?.isArgonHost || !navigator.userAgent.includes("Win")) return;
  initialized = true;

  const sys = useSystemStore();
  const call = useUnifiedCall();
  const win = useWindow();
  // Pinia unwraps refs on the store instance, so `currentLocale` is a plain reactive string here —
  // watch it via a getter rather than as a ref.
  const locale = useLocale();
  const t = locale.t;

  // ── Jump list: quick actions on the taskbar / Start right-click. Re-publish on locale change. ──
  watch(
    () => locale.currentLocale,
    () => {
      try {
        // @ts-ignore — dynamic HostProc RPC method
        native?.hostProc.setJumpTasks([
          { id: "open", title: t("taskbar.open") },
          { id: "settings", title: t("settings") },
          { id: "toggle-mute", title: t("taskbar.toggle_mic") },
          { id: "toggle-deafen", title: t("taskbar.toggle_deafen") },
        ]);
      } catch (e) {
        logger.error("[taskbar] setJumpTasks failed:", e);
      }
    },
    { immediate: true },
  );

  // ── Thumbnail toolbar: live call controls. Cleared when not in a call. ──
  let thumbToken = 0;
  async function publishThumbButtons() {
    const token = ++thumbToken;
    try {
      if (!call.isConnected) {
        // @ts-ignore — dynamic HostProc RPC method
        native?.hostProc.setThumbButtons([]);
        return;
      }
      const micMuted = sys.microphoneMuted;
      const deafened = sys.headphoneMuted;
      const [micIcon, deafenIcon, hangIcon] = await Promise.all([
        rasterize(micMuted ? "mic-off" : "mic"),
        rasterize(deafened ? "headphone-off" : "headphones"),
        rasterize("phone-off"),
      ]);
      // A newer state landed while we were rasterizing — let that run win.
      if (token !== thumbToken) return;
      // @ts-ignore — dynamic HostProc RPC method
      native?.hostProc.setThumbButtons([
        { id: "toggle-mute", tooltip: micMuted ? t("unmute") : t("mute"), iconDataUrl: micIcon },
        { id: "toggle-deafen", tooltip: deafened ? t("undeafen") : t("taskbar.deafen"), iconDataUrl: deafenIcon },
        { id: "hangup", tooltip: t("taskbar.hang_up"), iconDataUrl: hangIcon },
      ]);
    } catch (e) {
      logger.error("[taskbar] setThumbButtons failed:", e);
    }
  }

  watch(
    () => [call.isConnected, sys.microphoneMuted, sys.headphoneMuted, locale.currentLocale],
    () => void publishThumbButtons(),
    { immediate: true },
  );

  // ── Route clicked actions (jump list + thumbnail toolbar share ids) back into the stores. ──
  const taskbar = (window as any).argonTaskbar;
  taskbar?.onAction?.((payload: { kind: string; id: string }) => {
    try {
      switch (payload?.id) {
        case "open":
          // The host already surfaced the window on activation — nothing more to do.
          break;
        case "settings":
          win.settingsOpen = true;
          break;
        case "toggle-mute":
          void sys.toggleMicrophoneMute();
          break;
        case "toggle-deafen":
          void sys.toggleHeadphoneMute();
          break;
        case "hangup":
          void call.leave();
          break;
      }
    } catch (e) {
      logger.error("[taskbar] action dispatch failed:", e);
    }
  });
}
