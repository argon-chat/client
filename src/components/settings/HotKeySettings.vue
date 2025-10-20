<script setup lang="ts">
import { useLocale } from "@/store/localeStore";
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { keyCodeToCodes } from "@/lib/keyCodes";
import { type HotKeyAction, useHotkeys } from "@/store/hotKeyStore";

const { t } = useLocale();
const hotKeyStore = useHotkeys();

const editingId = ref<string | null>(null);
const pressedKeys = ref<Set<string>>(new Set());
const lastKeyCode = ref<{ code: string; keyCode: number } | null>(null);

const modifiers = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

const normalizeKey = (code: string): string => {
  const replacements: Record<string, string> = {
    ControlLeft: "Ctrl",
    ControlRight: "Ctrl",
    AltLeft: "Alt",
    AltRight: "Alt",
    ShiftLeft: "Shift",
    ShiftRight: "Shift",
    MetaLeft: "Win",
    MetaRight: "Win",
  };
  return replacements[code] || code.toUpperCase();
};

const hotkeyString = computed(() => {
  const keys = Array.from(pressedKeys.value);
  return keys.join(" + ");
});

const startListening = (id: string) => {
  editingId.value = id;
  pressedKeys.value.clear();
  lastKeyCode.value = null;
};

const stopListening = async () => {
  if (editingId.value !== null) {
    const action = hotKeyStore.allHotKeys.get(editingId.value);

    if (
      action &&
      lastKeyCode.value &&
      (lastKeyCode.value.keyCode === 27 || lastKeyCode.value.keyCode === 8)
    ) {
      action.keyCode = 0;
      action.mod = null;
      await hotKeyStore.doVerifyHotkeys();
    } 
    else if (action && lastKeyCode.value) {
      action.keyCode = lastKeyCode.value.keyCode;

      if (!action.mod) {
        action.mod = {
          hasAlt: false,
          hasCtrl: false,
          hasWin: false,
          hasShift: false,
        };
      }

      action.mod.hasAlt = pressedKeys.value.has("Alt");
      action.mod.hasCtrl = pressedKeys.value.has("Ctrl");
      action.mod.hasWin = pressedKeys.value.has("Win");
      action.mod.hasShift = pressedKeys.value.has("Shift");

      await hotKeyStore.doVerifyHotkeys();
    } 
    else {
      console.warn("Ignored pure modifier hotkey");
    }
  }

  editingId.value = null;
  pressedKeys.value.clear();
  lastKeyCode.value = null;
};
const handleKeyDown = (event: KeyboardEvent) => {
  if (editingId.value === null) return;
  event.preventDefault();

  const key = normalizeKey(event.code);

  if (modifiers.has(event.code)) {
    pressedKeys.value.add(key);
    lastKeyCode.value = null;
    return;
  }
  pressedKeys.value.add(key);
  lastKeyCode.value = { keyCode: event.keyCode, code: event.code };
};
const formatHotKey = (ht: HotKeyAction) => {
  if (!ht.mod) return keyCodeToCodes(ht.keyCode).at(0);
  const { hasAlt, hasCtrl, hasShift, hasWin } = ht.mod;

  if (!hasAlt && !hasCtrl && !hasShift && !hasWin)
    return keyCodeToCodes(ht.keyCode).at(0);
  let str = keyCodeToCodes(ht.keyCode).at(0);

  if (hasAlt) str += "+Alt";
  if (hasCtrl) str += "+Ctrl";
  if (hasShift) str += "+Shift";
  if (hasWin) str += "+Win";
  return str;
};

const handleKeyUp = (event: KeyboardEvent) => {
  if (editingId.value === null) return;
  event.preventDefault();
  setTimeout(() => stopListening(), 10);
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
                <TableHead class="w-[300px] text-center">
                    {{ t("name") }}
                </TableHead>
                <TableHead>{{ t("hotkey") }}</TableHead>
                <TableHead class="text-right">

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger as-child>
                                <div>
                                    {{ t("is_global_q") }}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>
                                    {{ t("global_toltip") }}
                                </p>
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
                    <span v-if="action.disabled" class="cursor-pointer text-gray-600 hover:underline disabled">
                        {{ formatHotKey(action) }}
                    </span>
                    <Input v-else-if="editingId === action.actionKey" type="text"
                        class="border px-2 py-1 w-full focus:outline-none" :placeholder="t('press_any_key')" readonly
                        :value="hotkeyString" @blur="stopListening" />
                    <span v-else class="cursor-pointer text-blue-600 hover:underline"
                        @click="startListening(action.actionKey)">
                        {{ formatHotKey(action) }}
                    </span>

                </TableCell>
                <TableCell class="text-right">

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger as-child>
                                <Switch v-model:checked="action.isGlobal" v-model="action.isGlobal" disabled />
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
