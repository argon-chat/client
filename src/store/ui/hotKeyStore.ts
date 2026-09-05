/**
 * Global hotkeys: which key does what, and the events when one is pressed.
 *
 * The store is the single owner of the bindings. It persists them, pushes the full list to the
 * desktop host whenever anything changes (the host keeps no state of its own worth reconciling),
 * and turns the host's "binding went down / up" events into a stream the actions subscribe to
 * (see lib/hotkeys/actions.ts). What each action does is not decided here.
 *
 * Old bindings (an action key plus a "mode") are migrated once into the new fixed actions:
 * "toggle microphone" in hold mode was push-to-talk, everything else keeps its meaning. On the
 * web build the store exists so the settings screen can render its notice, and does nothing.
 */

import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { Subject, filter, type Subscription } from "rxjs";
import { persistedValue, readPersistedValue } from "@argon/storage";
import { logger } from "@argon/core";
import {
  HOTKEY_ACTIONS,
  isHotkeyActionId,
  type HotkeyActionId,
} from "@/lib/hotkeys/catalog";
import {
  chordEquals,
  isEmptyChord,
  normalizeChord,
  type HotkeyChord,
} from "@/lib/hotkeys/chord";
import {
  captureFailureReason,
  hotkeyHost,
  type HotkeyHostBinding,
  type HotkeyHostStatus,
} from "@/lib/hotkeys/host";

export type HotkeyBindings = Partial<Record<HotkeyActionId, HotkeyChord | null>>;

export interface HotkeyOptions {
  /** Master switch: off sends the host an empty list and greys the screen out. */
  enabled: boolean;
  /** Push-to-talk: keep the microphone open this long after the key is released. */
  pttReleaseDelayMs: number;
  /** Push-to-talk: walkie-talkie beeps when the microphone opens and closes. */
  pttRadioBeeps: boolean;
}

export type HotkeyEventPhase = "down" | "up";

export interface HotkeyEvent {
  id: HotkeyActionId;
  phase: HotkeyEventPhase;
}

export type HotkeyCaptureResult = "bound" | "cancelled" | "failed";

export const DEFAULT_HOTKEY_OPTIONS: Readonly<HotkeyOptions> = {
  enabled: true,
  pttReleaseDelayMs: 0,
  pttRadioBeeps: false,
};

const BINDINGS_KEY = "hotkeys.bindings.v3";
const OPTIONS_KEY = "hotkeys.options.v3";
/** The previous store: a Map of ion HotkeyDescriptor by action key. */
const LEGACY_KEY = "HotKeyAction_v2";

/** What the old store persisted. `action`: 0 trigger, 1 hold, 2 toggle. */
export interface LegacyHotkeyBinding {
  id: string;
  chord?: { buttons?: { device: number; code: number }[] } | null;
  action?: number;
}

const LEGACY_HOLD = 1;

/** Old action keys → new actions. The only mode that changed meaning was "hold" on the toggle. */
export function migrateLegacyBindings(legacy: Iterable<LegacyHotkeyBinding>): HotkeyBindings {
  const out: HotkeyBindings = {};
  for (const item of legacy) {
    if (!item || isEmptyChord(item.chord as HotkeyChord | null)) continue;
    const chord = normalizeChord(item.chord as HotkeyChord);
    let target: HotkeyActionId | null = null;
    switch (item.id) {
      case "key.microphone.toggle":
        target = item.action === LEGACY_HOLD ? "voice.pushToTalk" : "voice.toggleMute";
        break;
      case "key.microphone.on": target = "voice.unmute"; break;
      case "key.microphone.off": target = "voice.mute"; break;
      case "key.sound.toggle": target = "voice.toggleDeafen"; break;
      case "key.sound.on": target = "voice.deafen"; break;
      case "key.sound.off": target = "voice.undeafen"; break;
      default:
        if (isHotkeyActionId(item.id)) target = item.id;
    }
    if (target && !out[target]) out[target] = chord;
  }
  return out;
}

function readInitialBindings(): HotkeyBindings {
  const current = readPersistedValue<HotkeyBindings | null>(BINDINGS_KEY, null);
  if (current && typeof current === "object") return current;
  const legacy = readPersistedValue<unknown>(LEGACY_KEY, null);
  if (legacy instanceof Map) {
    const migrated = migrateLegacyBindings(legacy.values() as Iterable<LegacyHotkeyBinding>);
    if (Object.keys(migrated).length) logger.info("[hotkeys] migrated bindings:", Object.keys(migrated));
    return migrated;
  }
  return {};
}

export const useHotkeys = defineStore("hotkeys", () => {
  const bindings = persistedValue<HotkeyBindings>(BINDINGS_KEY, readInitialBindings());
  const options = persistedValue<HotkeyOptions>(OPTIONS_KEY, { ...DEFAULT_HOTKEY_OPTIONS });
  // Options added after a user first saved theirs are missing from the stored object.
  for (const [key, value] of Object.entries(DEFAULT_HOTKEY_OPTIONS)) {
    if ((options as Record<string, unknown>)[key] === undefined) {
      (options as Record<string, unknown>)[key] = value;
    }
  }

  const hostStatus = ref<HotkeyHostStatus | null>(null);
  const syncError = ref<string | null>(null);
  /** The action whose key is being recorded right now. */
  const capturingFor = ref<HotkeyActionId | null>(null);
  const captureError = ref<string | null>(null);
  const events$ = new Subject<HotkeyEvent>();

  // ── Bindings ─────────────────────────────────────────────────────

  function chordOf(id: HotkeyActionId): HotkeyChord | null {
    const chord = bindings[id];
    return chord && !isEmptyChord(chord) ? chord : null;
  }

  function isBound(id: HotkeyActionId): boolean {
    return chordOf(id) !== null;
  }

  const boundCount = computed(() => HOTKEY_ACTIONS.filter((a) => isBound(a.id)).length);

  function setBinding(id: HotkeyActionId, chord: HotkeyChord | null): void {
    bindings[id] = chord && !isEmptyChord(chord) ? normalizeChord(chord) : null;
  }

  function clearBinding(id: HotkeyActionId): void {
    setBinding(id, null);
  }

  /** Other actions bound to exactly the same keys. Allowed (both fire), but worth showing. */
  function conflictsOf(id: HotkeyActionId): HotkeyActionId[] {
    const mine = chordOf(id);
    if (!mine) return [];
    return HOTKEY_ACTIONS.map((a) => a.id).filter((other) => {
      if (other === id) return false;
      const theirs = chordOf(other);
      return theirs !== null && chordEquals(theirs, mine);
    });
  }

  /** What the host gets: every bound action, or nothing while the master switch is off. */
  function hostBindings(): HotkeyHostBinding[] {
    if (!options.enabled) return [];
    const list: HotkeyHostBinding[] = [];
    for (const action of HOTKEY_ACTIONS) {
      const chord = chordOf(action.id);
      if (chord) list.push({ id: action.id, chord });
    }
    return list;
  }

  // ── Host ─────────────────────────────────────────────────────────

  async function sync(): Promise<void> {
    if (!hotkeyHost.available) return;
    try {
      await hotkeyHost.setBindings(hostBindings());
      syncError.value = null;
    } catch (e) {
      syncError.value = String(e);
      logger.error("[hotkeys] failed to push bindings to the host:", e);
    }
  }

  async function refreshStatus(): Promise<HotkeyHostStatus | null> {
    if (!hotkeyHost.available) return null;
    try {
      hostStatus.value = await hotkeyHost.status();
    } catch (e) {
      logger.warn("[hotkeys] status unavailable:", e);
    }
    return hostStatus.value;
  }

  async function restartHost(): Promise<void> {
    if (!hotkeyHost.available) return;
    try {
      await hotkeyHost.restart();
      await sync();
    } catch (e) {
      logger.error("[hotkeys] restart failed:", e);
    }
    await refreshStatus();
  }

  // ── Recording ────────────────────────────────────────────────────

  /**
   * Records the next key combination as the key for `id`. Resolves "cancelled" on Esc, timeout or
   * when another recording started meanwhile; "failed" when the host could not record at all.
   */
  async function captureFor(id: HotkeyActionId): Promise<HotkeyCaptureResult> {
    if (!hotkeyHost.available) {
      captureError.value = "Hotkeys are available only in the desktop app";
      return "failed";
    }
    capturingFor.value = id;
    captureError.value = null;
    try {
      const chord = await hotkeyHost.captureOnce();
      if (isEmptyChord(chord)) return "cancelled";
      setBinding(id, chord);
      return "bound";
    } catch (e) {
      if (captureFailureReason(e)) return "cancelled";
      captureError.value = e instanceof Error ? e.message : String(e);
      logger.warn("[hotkeys] capture failed:", e);
      return "failed";
    } finally {
      // A newer recording may own the field by now.
      if (capturingFor.value === id) capturingFor.value = null;
    }
  }

  async function cancelCapture(): Promise<void> {
    if (!capturingFor.value) return;
    await hotkeyHost.cancelCapture();
  }

  // ── Events ───────────────────────────────────────────────────────

  function onAction(id: HotkeyActionId, cb: (event: HotkeyEvent) => void): Subscription {
    return events$.pipe(filter((e) => e.id === id)).subscribe(cb);
  }

  /** Feeds an event as if the host had sent it. Used by the host bridge and by tests. */
  function dispatch(id: string, phase: HotkeyEventPhase): void {
    if (!isHotkeyActionId(id)) {
      logger.warn("[hotkeys] event for an unknown action:", id);
      return;
    }
    events$.next({ id, phase });
  }

  if (hotkeyHost.available) {
    hotkeyHost.onFired(dispatch);
    watch(() => JSON.stringify(hostBindings()), () => void sync(), { immediate: true });
    void refreshStatus();
  }

  return {
    bindings,
    options,
    hostStatus,
    syncError,
    capturingFor,
    captureError,
    boundCount,
    chordOf,
    isBound,
    setBinding,
    clearBinding,
    conflictsOf,
    captureFor,
    cancelCapture,
    onAction,
    dispatch,
    sync,
    refreshStatus,
    restartHost,
  };
});
