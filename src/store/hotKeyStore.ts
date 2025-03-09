import { logger } from "@/lib/logger";
import { persistedValue } from "@/lib/persistedValue";
import { defineStore } from "pinia";
import { filter, Subject, Subscription } from "rxjs";
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
};

export type HotKeyAction = {
  actionKey: string;
  mod: HotKeyMod | null;
  keyCode: number;
  isGlobal: boolean;
  errText?: string;
  group: string;
  disabled: boolean;
};

export const availableActions = [
  { actionKey: "key.microphone.toggle" as const, group: "audio", disabled: false },
  { actionKey: "key.microphone.on" as const, group: "audio", disabled: false },
  { actionKey: "key.microphone.off" as const, group: "audio", disabled: false },
  { actionKey: "key.sound.toggle" as const, group: "audio", disabled: true },
  { actionKey: "key.sound.on" as const, group: "audio", disabled: true },
  { actionKey: "key.sound.off" as const, group: "audio", disabled: true },
] satisfies HotketActionGroup[];

export type ActionKey = (typeof availableActions)[number]["actionKey"];

export const useHotkeys = defineStore("hotkeys", () => {
  const dictHandlers = new Map<number, string>();
  const dictActions = new Map<string, number>();
  const hotkeyExecuted = new Subject<ActionKey>();
  const isPaused = ref(false);

  const allHotKeys = persistedValue<Map<string, HotKeyAction>>(
    "HotKeyAction_all",
    new Map()
  );

  for (let i of availableActions) {
    if (!allHotKeys.has(i.actionKey)) {
      allHotKeys.set(i.actionKey, {
        actionKey: i.actionKey,
        isGlobal: true,
        keyCode: 0,
        mod: null,
        group: i.group,
        disabled: i.disabled
      });
    } else {
      const hte = allHotKeys.get(i.actionKey);

      if (hte) hte.errText = undefined;
    }
  }

  function onHotKeyCalled(key: number) {
    logger.log(`onHotKeyCalled: ${key}`, dictHandlers, dictActions, isPaused);
    //if (isPaused) return;
    logger.log(`onHotKeyCalled (no paused): ${key}`);
    if (dictHandlers.has(key)) {
      const eta = dictHandlers.get(key)! as any;
      logger.log(`onHotKeyCalled (no paused): ${key}, eta: ${eta}`);

      hotkeyExecuted.next(dictHandlers.get(key)! as any);
    }
  }

  const pinnedHotKeyCallback = argon.isArgonHost
    ? native.createPinnedObject(onHotKeyCalled)
    : ({} as any);

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

  async function doVerifyHotkeys() {
    if (argon.isArgonHost) native.clearAllKeybinds();
    dictActions.clear();

    for (let i of allHotKeys.values()) {
      if (i.keyCode == 0) {
        if (i.errText) i.errText = undefined;
        continue;
      }

      if (dictActions.has(i.actionKey)) {
        if (i.errText) i.errText = undefined;
        continue; // TODO verify combination
      }

      logger.log(
        `DoVerify, call bind ${i.actionKey} ->> ${i.keyCode}+${i.mod}`
      );

      try {
        const result = await createHotKey(i.keyCode, i.actionKey, i.mod);

        if (!result) {
          allHotKeys.get(i.actionKey)!.errText = "unknown error";
          continue;
        }
      } catch (e) {
        allHotKeys.get(i.actionKey)!.errText = `${e}`;
      }
    }
  }

  async function createHotKey(
    keycode: number,
    action: string,
    mod: HotKeyMod | null
  ) {
    const i = await native.createKeybind(
      {
        keyCode: keycode,
        keyMod: mod ? encodeHotkeyModification(mod) : 0,
      },
      pinnedHotKeyCallback
    );

    dictHandlers.set(i, action);
    dictActions.set(action, i);
    return true;
  }

  function onAction(key: ActionKey, func: () => void): Subscription {
    return hotkeyExecuted
      .pipe(filter((event) => event === key))
      .subscribe(func);
  }

  doVerifyHotkeys();

  return {
    createHotKey,
    hotkeyExecuted,
    isPaused,
    allHotKeys,
    doVerifyHotkeys,
    onAction,
  };
});
