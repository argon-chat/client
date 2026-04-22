<template>
  <div v-if="controls && controls.length" class="message-controls">
    <div v-for="(row, ri) in controls" :key="ri" class="control-row">
      <template v-for="(ctrl, ci) in row.controls" :key="ci">
        <!-- Button control -->
        <button
          v-if="ctrl.type === ControlType.Button"
          class="control-btn"
          :class="{
            'control-btn-disabled': ctrl.disabled,
            'control-btn-link': ctrl.variant === ButtonVariant.Link,
          }"
          :style="buttonStyle(ctrl)"
          :disabled="ctrl.disabled || isControlLoading(ctrl)"
          @click="onButtonClick(ctrl)"
        >
          <Loader2Icon v-if="isControlLoading(ctrl)" class="w-3.5 h-3.5 animate-spin" />
          <span v-else>{{ ctrl.label }}</span>
          <ExternalLinkIcon v-if="ctrl.variant === ButtonVariant.Link" class="w-3 h-3 ml-1 opacity-60" />
        </button>

        <!-- StringSelect control -->
        <Select
          v-else-if="ctrl.type === ControlType.StringSelect"
          :disabled="ctrl.disabled || false"
          @update:model-value="(val: string) => onSelectChange(ctrl, val)"
        >
          <SelectTrigger class="control-select-trigger">
            <SelectValue :placeholder="ctrl.placeholder || t('select_option') || 'Select...'" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="opt in (ctrl.options ?? [])"
              :key="opt.value"
              :value="opt.value"
            >
              <div class="flex flex-col">
                <span>{{ opt.label }}</span>
                <span v-if="opt.description" class="text-xs text-muted-foreground">{{ opt.description }}</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@argon/ui/select";
import { Loader2Icon, ExternalLinkIcon } from "lucide-vue-next";
import { useBotInteraction } from "@/composables/useBotInteraction";
import { useLocale } from "@/store/system/localeStore";
import { ControlType, ButtonVariant, type BotControl, type ControlRow } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

const { t } = useLocale();
const botInteraction = useBotInteraction();

const props = defineProps<{
  controls: ControlRow[];
  messageId: bigint;
  spaceId: Guid;
  channelId: Guid;
}>();

const loadingControlIds = computed(() => {
  const ids = new Set<string>();
  for (const [, state] of botInteraction.pendingInteractions) {
    if (state === "pending") {
      // We track by interactionId, not controlId, so we rely on the button disabled state
    }
  }
  return ids;
});

// Track which controls are currently loading
const pendingControlId = computed(() => {
  // Simple approach: track at component level
  return null as string | null;
});

function isControlLoading(_ctrl: BotControl): boolean {
  return false; // Loading state is tracked via pendingInteractions map in the store
}

function buttonStyle(ctrl: BotControl) {
  if (!ctrl.colour) return {};
  const { l, c, h } = ctrl.colour;
  return {
    "--btn-bg": `oklch(${l} ${c} ${h})`,
    "--btn-bg-hover": `oklch(${Math.min(l + 0.05, 1)} ${c} ${h})`,
    backgroundColor: `oklch(${l} ${c} ${h})`,
    color: l > 0.6 ? "#000" : "#fff",
  };
}

function onButtonClick(ctrl: BotControl) {
  if (ctrl.disabled) return;

  if (ctrl.variant === ButtonVariant.Link) {
    if (ctrl.url) {
      try {
        const parsed = new URL(ctrl.url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          window.open(ctrl.url, "_blank", "noopener,noreferrer");
        }
      } catch {
        // Invalid URL, ignore
      }
    }
    return;
  }

  // Callback button
  if (ctrl.id) {
    botInteraction.interactWithControl(
      props.spaceId,
      props.channelId,
      props.messageId,
      ctrl.id,
    );
  }
}

function onSelectChange(ctrl: BotControl, value: string) {
  if (ctrl.disabled || !ctrl.customId) return;
  botInteraction.interactWithSelect(
    props.spaceId,
    props.channelId,
    props.messageId,
    ctrl.customId,
    [value],
  );
}
</script>

<style scoped>
.message-controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  max-width: 400px;
}

.control-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.control-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  min-height: 32px;
}

.control-btn:hover:not(:disabled) {
  background: hsl(var(--accent));
}

.control-btn[style*="--btn-bg"]:hover:not(:disabled) {
  filter: brightness(1.1);
}

.control-btn-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.control-btn-link {
  color: hsl(var(--primary));
}

.control-select-trigger {
  min-width: 150px;
  max-width: 300px;
  height: 32px;
  font-size: 13px;
}
</style>
