<script setup lang="ts">
import { ref } from "vue";
import { useLocale } from "@/store/localeStore";
import { useHotkeys } from "@/store/hotKeyStore";

import {
  HotkeyActionType,
  type HotkeyChord,
} from "@/lib/glue/argon.ipc";

import { Button } from "@/components/ui/button";
import KbdGroup from "@/components/kbd/KbdGroup.vue";
import Kbd from "@/components/kbd/Kbd.vue";
import { keyCodeToFormatterSymbolsOrNames, keyCodeToNames } from "@/lib/keyCodes";
import AddHotkeyModal from "../modals/AddHotkeyModal.vue";
import Badge from "../ui/badge/Badge.vue";

const { t } = useLocale();
const hotkeys = useHotkeys();

const isModalOpen = ref(false);
const selectedActionKey = ref<string | undefined>(undefined);

const selectedActionType = ref<HotkeyActionType>(
  HotkeyActionType.Trigger
);

const capturedChord = ref<HotkeyChord | null>(null);
const captureError = ref<string | null>(null);


const hotkeyActionTypeLabel: Record<HotkeyActionType, string> = {
  [HotkeyActionType.Trigger]: "Trigger",
  [HotkeyActionType.Hold]: "Hold",
  [HotkeyActionType.Toggle]: "Toggle",
};


function openModal() {
  selectedActionKey.value = undefined;
  selectedActionType.value = HotkeyActionType.Trigger;
  capturedChord.value = null;
  captureError.value = null;
  isModalOpen.value = true;
}

function closeModal() {
  isModalOpen.value = false;
}

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Win"];



function hotkeyLabels(chord: HotkeyChord): string[] {
  return chord.buttons
    .map(b => keyCodeToFormatterSymbolsOrNames(b.code) ?? `VK_${b.code}`)
    .sort((a, b) => {
      const ia = MODIFIER_ORDER.indexOf(a);
      const ib = MODIFIER_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
}

function removeHotkey(id: string) {
  hotkeys.remove(id)
}
</script>
<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">
        {{ t("hotkeys") }}
      </h2>

      <Button @click="openModal">
        {{ t("add_hotkey") }}
      </Button>
    </div>

    <div class="flex flex-col gap-2">
      <div v-for="hk in hotkeys.allHotKeys.values()" :key="hk.id" class="
          group
          flex items-center gap-4
          px-4 py-3
          rounded-md
          border
          bg-background
          transition-all
          hover:bg-muted/40
        ">
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate">
            {{ t(hk.id) }}
          </div>

          <div v-if="hk.errText" class="text-xs text-red-600 mt-0.5">
            {{ hk.errText }}
          </div>
        </div>

        <div class="min-w-[160px] flex justify-center">
          <template v-if="hk.chord.buttons.length">
            <KbdGroup>
              <template v-for="(label, i) in hotkeyLabels(hk.chord)" :key="i">
                <Kbd class="text-sm">
                  {{ label }}
                </Kbd>
                <span v-if="i < hk.chord.buttons.length - 1" class="mx-1 text-muted-foreground">
                  +
                </span>
              </template>
            </KbdGroup>
          </template>

          <span v-else class="text-sm text-muted-foreground">
            —
          </span>
        </div>

        <div class="text-xs text-muted-foreground w-[80px] text-right">

          <Badge variant="outline">
            {{ hotkeyActionTypeLabel[hk.action] }}
          </Badge>
        </div>

        <Button variant="ghost" size="icon" class="
            opacity-0
            group-hover:opacity-100
            transition-opacity
            text-muted-foreground
            hover:text-destructive
          " @click="removeHotkey(hk.id)" aria-label="Delete hotkey">
          ✕
        </Button>
      </div>
    </div>

    <AddHotkeyModal :open="isModalOpen" @close="closeModal" />
  </div>
</template>
