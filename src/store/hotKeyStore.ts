import {
  HotkeyActionType,
  HotkeyChord,
  HotkeyDescriptor,
  HotkeyPhase,
  HotKeyTriggered,
} from "@/lib/glue/argon.ipc";
import { native } from "@/lib/glue/nativeGlue";
import { logger } from "@/lib/logger";
import { persistedValue } from "@/lib/persistedValue";
import { defineStore } from "pinia";
import { filter, Subject, type Subscription } from "rxjs";
import { ref } from "vue";

export type HotKeyMod = {
  hasCtrl: boolean;
  hasWin: boolean;
  hasShift: boolean;
  hasAlt: boolean;
};

export type HotketActionGroup = {
  actionKey: string;
  group: string;
  disabled: boolean;
  isRadioMode: boolean;
};

export type HotKeyAction = {
  actionKey: string;
  mod: HotKeyMod | null;
  keyCode: number;
  isGlobal: boolean;
  errText?: string;
  group: string;
  disabled: boolean;
  isRadioMode: boolean;
};

function createDefaultHotkeys() {
  const map = new Map<string, ExtendedHotkeyDescriptor>();

  return map;
}

export const availableActions = [
  {
    actionKey: "key.microphone.toggle" as const,
    group: "audio",
    disabled: false,
    isRadioMode: false,
  },
  {
    actionKey: "key.microphone.on" as const,
    group: "audio",
    disabled: false,
    isRadioMode: false,
  },
  {
    actionKey: "key.microphone.off" as const,
    group: "audio",
    disabled: false,
    isRadioMode: false,
  },
  {
    actionKey: "key.sound.toggle" as const,
    group: "audio",
    disabled: true,
    isRadioMode: false,
  },
  {
    actionKey: "key.sound.on" as const,
    group: "audio",
    disabled: true,
    isRadioMode: false,
  },
  {
    actionKey: "key.sound.off" as const,
    group: "audio",
    disabled: true,
    isRadioMode: false,
  },
] satisfies HotketActionGroup[];

export type ActionKey = (typeof availableActions)[number]["actionKey"];

export type ExtendedHotkeyDescriptor = {
  errText: string | null;
} & HotkeyDescriptor;

type NativeHotkeyEvent = {
  type: "hotkey";
  id: string;
  phase: HotkeyPhase;
  ts: number;
};

export const useHotkeys = defineStore("hotkeys", () => {
  const allHotKeys = persistedValue<Map<string, ExtendedHotkeyDescriptor>>(
    "HotKeyAction_v2",
    createDefaultHotkeys()
  );
  const hotkeyExecuted$ = new Subject<{keyId: string, phase: HotkeyPhase}>();
  const isPaused = ref(false);

  async function register(desc: HotkeyDescriptor) {
    logger.log("hotkeyRegister", desc);
    if (argon.isArgonHost) await native.hostProc.hotkeyRegister(desc);
  }
  async function unregister(id: string) {
    logger.log("hotkeyUnregister", id);
    if (argon.isArgonHost) await native.hostProc.hotkeyUnregister(id);
  }

  async function syncHotkey(hk: ExtendedHotkeyDescriptor) {
    console.log("[HOTKEY-STORE] syncHotkey", hk.id, hk);

    try {
      if (argon.isArgonHost) await native.hostProc.hotkeyUnregister(hk.id);
      console.log("[HOTKEY-STORE] unregistered", hk.id);
    } catch (e) {
      console.log("[HOTKEY-STORE] unregister error", e);
    }

    if (!hk.chord || hk.chord.buttons.length === 0) {
      console.log("[HOTKEY-STORE] skip register: empty chord");
      return;
    }

    /*if (hk.disabled) {
    console.log("[HOTKEY-STORE] skip register: disabled");
    return;
  }*/

    try {
      console.log("[HOTKEY-STORE] register start");
      if (argon.isArgonHost) await native.hostProc.hotkeyRegister(hk);
      console.log("[HOTKEY-STORE] register OK");
      console.log("[HOTKEY-STORE] enable OK");
    } catch (e) {
      console.log("[HOTKEY-STORE] register/enable ERROR", e);
      hk.errText = String(e);
    }
  }

  async function syncAll() {
    for (const hk of allHotKeys.values()) {
      if (argon.isArgonHost) await native.hostProc.hotkeyUnregister(hk.id);

      if (hk.chord.buttons.length != 0 /*&& !hk.disabled*/) {
        if (argon.isArgonHost) {
          await native.hostProc.hotkeyRegister(hk);
        }
      }
    }
  }

  async function remove(hotkeyId: string) {
    if (allHotKeys.delete(hotkeyId))
      if (argon.isArgonHost) await native.hostProc.hotkeyUnregister(hotkeyId);
  }

  async function captureOnce(): Promise<HotkeyChord> {
    if (!argon.isArgonHost) {
      throw new Error("Hotkey capture available only in desktop app");
    }

    await native.hostProc.hotkeyPause();
    try {
      return await native.hostProc.hotkeyCaptureOnce();
    } finally {
      await native.hostProc.hotkeyResume();
    }
  }

  function onAction(actionKey: string, fn: (v: { keyId: string, phase: HotkeyPhase }) => void) {
    return hotkeyExecuted$.pipe(filter((k) => k.keyId === actionKey)).subscribe(fn);
  }

  if (argon.isArgonHost) {
    const populatePinnedFn = argon.on<HotKeyTriggered>(
      "HotKeyTriggered",
      (x) => {
        hotkeyExecuted$.next({ keyId: x.hotkeyId, phase: x.phase });
        logger.warn("Hotkey triggered", x);
      }
    );
    
    native.hostProc.hotkeyFired(populatePinnedFn);
  }

  syncAll().catch(console.error);

  return {
    allHotKeys,
    register,
    remove,
    unregister,
    syncAll,
    onAction,
    isPaused,
    syncHotkey,
    captureOnce,
  };
});
