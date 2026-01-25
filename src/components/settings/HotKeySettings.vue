<script setup lang="ts">
import { ref, computed } from "vue";
import { useLocale } from "@/store/localeStore";
import { useHotkeys } from "@/store/hotKeyStore";
import {
  HotkeyActionType,
  type HotkeyChord,
} from "@argon/glue/ipc";
import { Button } from "@argon/ui/button";
import KbdGroup from "@/components/kbd/KbdGroup.vue";
import Kbd from "@/components/kbd/Kbd.vue";
import { keyCodeToFormatterSymbolsOrNames } from "@/lib/keyCodes";
import AddHotkeyModal from "../modals/AddHotkeyModal.vue";
import { Badge } from "@argon/ui/badge";
import { PlusIcon, TrashIcon, KeyboardIcon } from "lucide-vue-next";

// Stores
const { t } = useLocale();
const hotkeys = useHotkeys();

// State
const isModalOpen = ref(false);
const selectedActionKey = ref<string | undefined>(undefined);
const selectedActionType = ref<HotkeyActionType>(HotkeyActionType.Trigger);
const capturedChord = ref<HotkeyChord | null>(null);
const captureError = ref<string | null>(null);

// Constants
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Win"];

const HOTKEY_ACTION_LABELS: Record<HotkeyActionType, string> = {
  [HotkeyActionType.Trigger]: "Trigger",
  [HotkeyActionType.Hold]: "Hold",
  [HotkeyActionType.Toggle]: "Toggle",
};

// Computed
const hotkeysArray = computed(() => Array.from(hotkeys.allHotKeys.values()));
const hasHotkeys = computed(() => hotkeysArray.value.length > 0);

// Methods
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
  hotkeys.remove(id);
}
</script>
<template>
  <div class="hotkey-settings">
    <!-- Header -->
    <div class="settings-header">
      <div>
        <h2 class="text-2xl font-bold">{{ t("hotkeys") }}</h2>
        <p class="text-sm text-muted-foreground mt-1">
          {{ t("manage_keyboard_shortcuts") }}
        </p>
      </div>
      <Button v-if="hasHotkeys" @click="openModal" class="gap-2">
        <PlusIcon class="w-4 h-4" />
        {{ t("add_hotkey") }}
      </Button>
    </div>

    <!-- Hotkeys List -->
    <Transition name="fade" mode="out-in">
      <div v-if="hasHotkeys" class="hotkeys-list">
        <TransitionGroup name="hotkey-list" tag="div" class="space-y-2">
          <div 
            v-for="hk in hotkeysArray" 
            :key="hk.id" 
            class="hotkey-item"
          >
            <div class="hotkey-content">
              <!-- Info Section -->
              <div class="hotkey-info">
                <div class="hotkey-title">
                  {{ t(hk.id) }}
                </div>
                <Transition name="error-fade">
                  <div v-if="hk.errText" class="hotkey-error">
                    {{ hk.errText }}
                  </div>
                </Transition>
              </div>

              <!-- Keys Section -->
              <div class="hotkey-keys">
                <template v-if="hk.chord.buttons.length">
                  <KbdGroup>
                    <template v-for="(label, i) in hotkeyLabels(hk.chord)" :key="i">
                      <Kbd class="text-sm">{{ label }}</Kbd>
                      <span v-if="i < hk.chord.buttons.length - 1" class="kbd-separator">+</span>
                    </template>
                  </KbdGroup>
                </template>
                <span v-else class="no-binding">{{ t("not_set") }}</span>
              </div>

              <!-- Type Badge -->
              <div class="hotkey-type">
                <Badge variant="outline" class="badge-action">
                  {{ HOTKEY_ACTION_LABELS[hk.action] }}
                </Badge>
              </div>

              <!-- Delete Button -->
              <Button 
                variant="ghost" 
                size="icon" 
                class="delete-button"
                @click="removeHotkey(hk.id)" 
                :aria-label="`Delete ${t(hk.id)} hotkey`"
              >
                <TrashIcon class="w-4 h-4" />
              </Button>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state">
        <div class="empty-state-icon">
          <KeyboardIcon class="w-16 h-16 text-muted-foreground/30" />
        </div>
        <h3 class="empty-state-title">{{ t("no_hotkeys_yet") }}</h3>
        <p class="empty-state-description">
          {{ t("no_hotkeys_description") }}
        </p>
        <Button @click="openModal" class="gap-2 mt-4">
          <PlusIcon class="w-4 h-4" />
          {{ t("add_first_hotkey") }}
        </Button>
      </div>
    </Transition>

    <!-- Modal -->
    <AddHotkeyModal :open="isModalOpen" @close="closeModal" />
  </div>
</template>
<style scoped>
/* Layout */
.hotkey-settings {
  @apply space-y-6 max-w-5xl mx-auto;
}

.settings-header {
  @apply flex items-start justify-between gap-4 mb-6;
}

.hotkeys-list {
  @apply space-y-2;
}

/* Hotkey Item */
.hotkey-item {
  @apply rounded-xl border bg-card shadow-sm transition-all hover:shadow-md hover:border-primary/30;
}

.hotkey-content {
  @apply flex items-center gap-4 px-5 py-4;
}

.hotkey-info {
  @apply flex-1 min-w-0;
}

.hotkey-title {
  @apply font-medium text-base truncate;
}

.hotkey-error {
  @apply text-xs text-destructive mt-1;
}

.hotkey-keys {
  @apply min-w-[180px] flex justify-center;
}

.kbd-separator {
  @apply mx-1.5 text-muted-foreground font-semibold;
}

.no-binding {
  @apply text-sm text-muted-foreground italic;
}

.hotkey-type {
  @apply w-20 text-right;
}

.badge-action {
  @apply text-xs;
}

.delete-button {
  @apply opacity-0 transition-all hover:text-destructive hover:bg-destructive/10;
}

.hotkey-item:hover .delete-button {
  @apply opacity-100;
}

/* Empty State */
.empty-state {
  @apply flex flex-col items-center justify-center py-16 px-6 rounded-xl border-2 border-dashed border-muted bg-muted/5;
}

.empty-state-icon {
  @apply mb-4;
}

.empty-state-title {
  @apply text-xl font-semibold mb-2;
}

.empty-state-description {
  @apply text-sm text-muted-foreground text-center max-w-md;
}

/* Animations */
.fade-enter-active,
.fade-leave-active {
  @apply transition-all duration-300;
}

.fade-enter-from {
  @apply opacity-0 scale-95;
}

.fade-leave-to {
  @apply opacity-0 scale-105;
}

.error-fade-enter-active,
.error-fade-leave-active {
  @apply transition-all duration-200;
}

.error-fade-enter-from,
.error-fade-leave-to {
  @apply opacity-0 transform -translate-y-1;
}

.hotkey-list-move,
.hotkey-list-enter-active,
.hotkey-list-leave-active {
  @apply transition-all duration-300;
}

.hotkey-list-enter-from {
  @apply opacity-0 transform translate-x-8;
}

.hotkey-list-leave-to {
  @apply opacity-0 transform -translate-x-8;
}

.hotkey-list-leave-active {
  @apply absolute;
}
</style>