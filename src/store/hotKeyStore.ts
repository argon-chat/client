import { logger } from "@/lib/logger";
import { persistedValue } from "@/lib/persistedValue";
import { defineStore } from "pinia";
import { Subject } from "rxjs";
import { ref } from "vue";

export type HotKeyMod = {
  hasCtrl: boolean;
  hasWin: boolean;
  hasShift: boolean;
  hasAlt: boolean;
};

export type HotKeyAction = {
    actorKey: string;
    fullHotKeyString: string;
    mod: HotKeyMod;
    keyCode: number;
    localeKeyCode: string;
}

export const useHotkeys = defineStore("hotkeys", () => {
  const dict = new Map<number, string>();
  const hotkeyExecuted = new Subject<string>();
  const isPaused = ref(false);

  const allHotKeys = persistedValue<HotKeyAction[]>("HotKeyAction_all", []);

  function onHotKeyCalled(key: number) {
    if (isPaused) return;
    if (dict.has(key)) hotkeyExecuted.next(dict.get(key)!);
  }

  const pinnedHotKeyCallback = native.createPinnedObject(onHotKeyCalled);

  const enum HotkeyModification {
    NONE = 0,
    HAS_ALT = 1,
    HAS_CTRL = 1 << 1,
    HAS_SHIFT = 1 << 2,
    HAS_WIN = 1 << 3,
  }

  function encodeHotkeyModification(mods: HotKeyMod): number {
    return (
      (mods.hasAlt ? HotkeyModification.HAS_ALT : 0) |
      (mods.hasCtrl ? HotkeyModification.HAS_CTRL : 0) |
      (mods.hasShift ? HotkeyModification.HAS_SHIFT : 0) |
      (mods.hasWin ? HotkeyModification.HAS_WIN : 0)
    );
  }

  async function createHotKey(keycode: number, action: string, mod: HotKeyMod) {
    try {
      const i = await native.createKeybind(
        {
          keyCode: keycode,
          keyMod: encodeHotkeyModification(mod),
        },
        pinnedHotKeyCallback
      );

      dict.set(i, action);
      return true;
    } catch (e) {
      logger.error(e);
      return false;
    }
  }

  return {
    createHotKey,
    hotkeyExecuted,
    isPaused,
    allHotKeys
  };
});
