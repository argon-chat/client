<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useLocale } from "@/store/localeStore";
import {
  Table, TableBody, TableCaption, TableCell, TableHead,
  TableHeader, TableRow
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { keyCodeToCodes } from "@/lib/keyCodes";
import { type HotKeyAction, useHotkeys } from "@/store/hotKeyStore";

const { t } = useLocale();
const hotKeyStore = useHotkeys();

const editingId = ref<string | null>(null);
const pressedKeys = ref<Set<string>>(new Set());
const mainKey = ref<{ code: string; keyCode: number } | null>(null);

const MODIFIER_KEYCODES = new Set([16, 17, 18, 91, 92, 160, 161, 162, 163, 164, 165]);
const modifiers = new Set([
  "ControlLeft", "ControlRight", "AltLeft", "AltRight",
  "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"
]);

const normalizeKey = (code: string): string => {
  const map: Record<string, string> = {
    ControlLeft: "Ctrl", ControlRight: "Ctrl",
    AltLeft: "Alt", AltRight: "Alt",
    ShiftLeft: "Shift", ShiftRight: "Shift",
    MetaLeft: "Win", MetaRight: "Win",
  };
  return map[code] ?? code.replace(/^Key/, "").toUpperCase();
};

const hotkeyString = computed(() => {
  const keys = Array.from(pressedKeys.value);
  return keys.join(" + ");
});

const startListening = (id: string) => {
  editingId.value = id;
  pressedKeys.value.clear();
  mainKey.value = null;
};
const stopListening = async () => {
  console.log("%cSTOP LISTENING START", "color:#ff0");
  console.log("pressedKeys при стопе:", Array.from(pressedKeys.value));
  console.log("mainKey in stop:", mainKey.value);

  if (!editingId.value) {
    console.log("no editingId → exit");
    return;
  }

  const action = hotKeyStore.allHotKeys.get(editingId.value);
  const lk = mainKey.value;
  const code = lk?.code;
  const keyCode = lk?.keyCode;

  if (!action) {
    console.log("action not found");
    cleanup();
    return;
  }

  // Esc / Backspace
  if (lk && (lk.keyCode === 27 || lk.keyCode === 8)) {
    console.log("→ Reset hotkey");
    action.keyCode = 0;
    action.mod = null;
    await hotKeyStore.doVerifyHotkeys();
    cleanup();
    return;
  }

  const onlyMods =
    pressedKeys.value.size > 0 &&
    Array.from(pressedKeys.value).every(k =>
      ["Shift", "Ctrl", "Alt", "Win"].includes(k)
    );

  if (!lk || MODIFIER_KEYCODES.has(keyCode!) || onlyMods) {
    console.log("→ pure mod or not any main keycode");
    cleanup();
    return;
  }

  console.log("→ hotkey save:", lk, Array.from(pressedKeys.value));

  action.keyCode = keyCode!;
  if (!action.mod) {
    action.mod = { hasAlt: false, hasCtrl: false, hasWin: false, hasShift: false };
  }
  action.mod.hasAlt = pressedKeys.value.has("Alt");
  action.mod.hasCtrl = pressedKeys.value.has("Ctrl");
  action.mod.hasShift = pressedKeys.value.has("Shift");
  action.mod.hasWin = pressedKeys.value.has("Win");

  await hotKeyStore.doVerifyHotkeys();
  cleanup();
};

const cleanup = () => {
  editingId.value = null;
  pressedKeys.value.clear();
  mainKey.value = null;
};
const handleKeyDown = (e: KeyboardEvent) => {
  if (!editingId.value) return;

  let keyName = e.key;

  switch (keyName) {
    case " ": keyName = "Space"; break;
    case "Control": keyName = "Ctrl"; break;
    case "Meta": keyName = "Win"; break;
    case "ArrowUp": keyName = "Up"; break;
    case "ArrowDown": keyName = "Down"; break;
    case "ArrowLeft": keyName = "Left"; break;
    case "ArrowRight": keyName = "Right"; break;
  }

  const isModifier = ["Shift", "Ctrl", "Alt", "Win"].includes(keyName);

  console.log(
    `%ckeydown → key:${e.key}, keyName:${keyName}, keyCode:${e.keyCode}, isMod:${isModifier}`,
    "color:#6bf"
  );

  if (isModifier) {
    pressedKeys.value.add(keyName);
    return;
  }

  pressedKeys.value.add(keyName);
  mainKey.value = { code: keyName, keyCode: e.keyCode };

  console.log("→ added:", keyName, "pressedKeys:", Array.from(pressedKeys.value));
};
const handleKeyUp = (e: KeyboardEvent) => {
  if (!editingId.value) return;

  console.log(
    `%ckeyup → code: ${e.code}, key: ${e.key}, keyCode: ${e.keyCode}`,
    "color:#f96"
  );

  const norm = normalizeKey(e.code);
  if (pressedKeys.value.has(norm)) {
    pressedKeys.value.delete(norm);
    console.log("→ key removed:", norm);
  }
  console.log("pressedKeys after keyup:", Array.from(pressedKeys.value));

  setTimeout(() => {
    console.log("%cstopListening() called", "color:#ccc");
    stopListening();
  }, 150);
};
const formatHotKey = (ht: HotKeyAction) => {
  if (!ht) return "";
  const key = keyCodeToCodes(ht.keyCode)[0] ?? "—";
  const mods: string[] = [];
  if (ht.mod?.hasCtrl) mods.push("Ctrl");
  if (ht.mod?.hasAlt) mods.push("Alt");
  if (ht.mod?.hasShift) mods.push("Shift");
  if (ht.mod?.hasWin) mods.push("Win");
  return mods.length ? `${mods.join("+")}+${key}` : key;
};

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
});
onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keyup", handleKeyUp);
});
</script>

<template>
  <Table>
    <TableCaption>{{ t("list_hotkeys") }}</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead class="w-[300px] text-center">{{ t("name") }}</TableHead>
        <TableHead>{{ t("hotkey") }}</TableHead>
        <TableHead class="text-right">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>{{ t("is_global_q") }}</div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ t("global_toltip") }}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableHead>
      </TableRow>
    </TableHeader>

    <TableBody>
      <TableRow v-for="action in hotKeyStore.allHotKeys.values()" :key="action.actionKey">
        <TableCell class="font-medium text-center">
          <p>{{ t(action.actionKey) }}</p>
          <p v-if="action.errText" class="text-xs text-red-600">{{ action.errText }}</p>
        </TableCell>

        <TableCell>
          <Input v-if="editingId === action.actionKey" readonly :placeholder="t('press_any_key')"
            class="border px-2 py-1 w-full focus:outline-none" :value="hotkeyString" @blur="stopListening" />
          <span v-else class="cursor-pointer text-blue-600 hover:underline" @click="startListening(action.actionKey)">
            {{ formatHotKey(action) }}
          </span>
        </TableCell>

        <TableCell class="text-right">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <Switch v-model:checked="action.isGlobal" disabled />
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ t("global_toltip") }}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
