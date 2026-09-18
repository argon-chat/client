<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "@/store/system/localeStore";
import type { ProfileSceneTuning, SceneReach } from "@/cosmetics/kinds/profile-scene";

/**
 * How much of your own card a scene plays on.
 *
 * <b>Offered only when the row says the wearer may decide.</b> A scene drawn for the part of a card
 * above the board looks wrong on a card the board has stretched — the flowers grow from a line in
 * the middle of nowhere — and the person who drew it is the one who knows whether it survives that.
 * So the row says <c>content</c>, <c>card</c> or "ask", and this appears for the third.
 *
 * <b>Three choices rather than two, and the third is the point.</b> "As made" is not the same as
 * picking whichever value the row currently defaults to: it is deference, and it keeps following the
 * row when an operator changes their mind. Without it, everybody who ever opened this panel would be
 * pinned to whatever the default was on the day they looked.
 */
const props = defineProps<{ content: ProfileSceneTuning; disabled?: boolean }>();

const emit = defineEmits<{ "update:content": [value: ProfileSceneTuning] }>();

const { t } = useLocale();

interface Choice {
  readonly value: SceneReach | null;
  readonly labelKey: string;
}

const CHOICES: readonly Choice[] = [
  { value: null, labelKey: "cosmetic_scene_reach_author" },
  { value: "content", labelKey: "cosmetic_scene_reach_content" },
  { value: "card", labelKey: "cosmetic_scene_reach_card" },
];

const chosen = computed(() => props.content.reach);

function pick(value: SceneReach | null): void {
  if (props.disabled) return;

  emit("update:content", { reach: value });
}
</script>

<template>
  <div class="tuning">
    <div class="tuning-head">
      <span class="tuning-title">{{ t("cosmetic_scene_reach") }}</span>
      <span class="tuning-hint">{{ t("cosmetic_scene_reach_hint") }}</span>
    </div>

    <div class="reach" role="radiogroup" :aria-label="t('cosmetic_scene_reach')">
      <button
        v-for="choice in CHOICES"
        :key="choice.labelKey"
        class="reach-pick"
        :class="{ 'reach-pick--on': chosen === choice.value }"
        type="button"
        role="radio"
        :aria-checked="chosen === choice.value"
        :disabled="disabled"
        @click.prevent="pick(choice.value)"
      >
        {{ t(choice.labelKey) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* The panel every tuning form sits in, matching the one the name treatments use. */
.tuning {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 10px;
  padding: 11px 12px 12px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border) / 0.5);
  background:
    linear-gradient(180deg, hsl(var(--primary) / 0.05), transparent 60%),
    hsl(var(--background) / 0.35);
}

.tuning::before {
  content: "";
  position: absolute;
  top: -1px;
  left: 12%;
  right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, hsl(var(--primary) / 0.55), transparent);
}

.tuning-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.tuning-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.9);
}

.tuning-hint {
  flex: 1;
  min-width: 0;
  font-size: 0.68rem;
  color: hsl(var(--muted-foreground) / 0.8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * Three even segments rather than a dropdown.
 *
 * All three answers are on screen at once, which is what makes "as made" legible as an answer
 * instead of as an empty field.
 */
.reach {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: hsl(var(--background) / 0.5);
  border: 1px solid hsl(var(--border) / 0.4);
}

.reach-pick {
  padding: 5px 6px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: hsl(var(--muted-foreground));
  font-size: 0.7rem;
  font-weight: 500;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.reach-pick:hover:not(:disabled) {
  color: hsl(var(--foreground) / 0.9);
  background: hsl(var(--foreground) / 0.05);
}

.reach-pick--on {
  color: hsl(var(--foreground));
  background: hsl(var(--primary) / 0.16);
  border-color: hsl(var(--primary) / 0.45);
}

.reach-pick:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
