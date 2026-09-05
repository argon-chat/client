/**
 * What every hotkey action does.
 *
 * The catalogue names the actions and the store delivers "down" and "up" for each; this is the one
 * place that connects them to the stores they act on. Called once at start-up on the desktop; the
 * web build has no global hotkeys and skips it.
 *
 * Push-to-talk is deliberately silent: the mute/unmute tones would otherwise play on every press.
 * Its release can be delayed (so the end of a sentence is not cut off) and can play walkie-talkie
 * beeps instead. Push-to-mute restores the microphone only if it was on before the key went down.
 */

import { logger } from "@argon/core";
import { supports } from "@/lib/platform";
import { playUiBeep } from "@/lib/audio/uiBeep";
import { useHotkeys, type HotkeyEvent } from "@/store/ui/hotKeyStore";
import { useSystemStore } from "@/store/system/systemStore";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useWindow } from "@/store/ui/windowStore";
import { useGameOverlaySettings } from "@/store/features/gameOverlaySettingsStore";
import type { HotkeyActionId } from "./catalog";
import { hotkeyHost } from "./host";

let initialized = false;

type ActionHandler = (event: HotkeyEvent) => void | Promise<unknown>;

export function initHotkeyActions(): void {
  if (initialized || !supports("globalHotkeys")) return;
  initialized = true;

  const hotkeys = useHotkeys();
  const sys = useSystemStore();
  const call = useUnifiedCall();
  const win = useWindow();
  const overlay = useGameOverlaySettings();

  const bind = (id: HotkeyActionId, handler: ActionHandler) => {
    hotkeys.onAction(id, (event) => {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((err) => logger.error(`[hotkeys] ${id} failed:`, err));
        }
      } catch (err) {
        logger.error(`[hotkeys] ${id} failed:`, err);
      }
    });
  };
  const onPress = (id: HotkeyActionId, handler: () => void | Promise<unknown>) =>
    bind(id, (event) => (event.phase === "down" ? handler() : undefined));

  // ── Push-to-talk ─────────────────────────────────────────────────

  let pttReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  bind("voice.pushToTalk", ({ phase }) => {
    if (phase === "down") {
      if (pttReleaseTimer) {
        clearTimeout(pttReleaseTimer);
        pttReleaseTimer = null;
      }
      if (hotkeys.options.pttRadioBeeps) playUiBeep("ptt-on");
      return sys.setMicrophoneMuted(false, { silent: true });
    }
    if (hotkeys.options.pttRadioBeeps) playUiBeep("ptt-off");
    const close = () => {
      pttReleaseTimer = null;
      void sys.setMicrophoneMuted(true, { silent: true });
    };
    const delay = Math.max(0, Number(hotkeys.options.pttReleaseDelayMs) || 0);
    if (delay > 0) pttReleaseTimer = setTimeout(close, delay);
    else close();
  });

  // ── Push-to-mute ─────────────────────────────────────────────────

  let reopenAfterPushToMute = false;

  bind("voice.pushToMute", ({ phase }) => {
    if (phase === "down") {
      reopenAfterPushToMute = !sys.microphoneMuted;
      return sys.setMicrophoneMuted(true, { silent: true });
    }
    if (reopenAfterPushToMute) return sys.setMicrophoneMuted(false, { silent: true });
  });

  // ── Microphone and sound ─────────────────────────────────────────

  onPress("voice.toggleMute", () => sys.toggleMicrophoneMute());
  onPress("voice.mute", () => sys.setMicrophoneMuted(true));
  onPress("voice.unmute", () => sys.setMicrophoneMuted(false));
  onPress("voice.toggleDeafen", () => sys.toggleHeadphoneMute());
  onPress("voice.deafen", () => sys.setHeadphoneMuted(true));
  onPress("voice.undeafen", () => sys.setHeadphoneMuted(false));

  // ── Call ─────────────────────────────────────────────────────────

  onPress("call.leave", () => (call.isConnected ? call.leave() : undefined));
  onPress("call.toggleCamera", () => (call.isConnected ? call.toggleCamera() : undefined));
  onPress("call.stopScreenShare", () => (call.isSharing ? call.stopScreenShare() : undefined));

  // ── Argon ────────────────────────────────────────────────────────

  onPress("app.toggleWindow", () => hotkeyHost.toggleMainWindow());
  onPress("app.openSettings", () => {
    win.settingsOpen = true;
    return hotkeyHost.showMainWindow();
  });
  onPress("overlay.toggle", () => {
    overlay.overlayEnabled = !overlay.overlayEnabled;
  });
}
