<template>
  <div class="danger-zone-wrap">
    <div class="danger-zone">
      <div class="danger-hazard"></div>
      <div class="danger-scanlines"></div>
      <div class="danger-content">
        <div class="danger-header">
          <AlertTriangleIcon class="w-5 h-5 danger-icon" />
          <h3 class="danger-title" :data-text="t('danger_zone')">{{ t("danger_zone") }}</h3>
        </div>

        <h4 class="danger-action-title">{{ title }}</h4>
        <p class="danger-action-desc">{{ description }}</p>

        <!-- The action itself (and anything it needs to say first) comes from the caller; buttons
             use the `danger-btn` class, paragraphs `danger-action-desc`, both styled here. -->
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The red "you cannot undo this" block at the bottom of a settings page — server deletion,
 * channel deletion. One component so the two cannot drift apart in look.
 */
import { AlertTriangleIcon } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";

defineProps<{
  /** What the irreversible action is, e.g. "Delete channel". */
  title: string;
  /** What it does and that it cannot be undone. */
  description: string;
}>();

const { t } = useLocale();
</script>

<style scoped>
.danger-zone-wrap {
  filter: drop-shadow(0 0 14px hsl(350 90% 50% / 0.3));
}

.danger-zone {
  position: relative;
  overflow: hidden;
  background: linear-gradient(180deg, hsl(350 55% 7% / 0.96), hsl(350 50% 4% / 0.98));
  border: 1px solid hsl(350 90% 55% / 0.45);
  /* Angular, chamfered corners (top-right + bottom-left). */
  clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px));
}

/* Animated hazard tape. */
.danger-hazard {
  height: 6px;
  background: repeating-linear-gradient(-45deg, #ff003c 0, #ff003c 10px, #2a0010 10px, #2a0010 20px);
  opacity: 0.9;
  animation: dz-hazard 1.4s linear infinite;
}

@keyframes dz-hazard {
  to { background-position: 28.28px 0; }
}

/* CRT scanlines. */
.danger-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    hsl(350 90% 60% / 0.05) 0,
    hsl(350 90% 60% / 0.05) 1px,
    transparent 1px,
    transparent 3px
  );
}

.danger-content {
  position: relative;
  padding: 1.1rem 1.5rem 1.4rem;
}

.danger-header {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.9rem;
}

.danger-icon {
  color: #ff2a6d;
  filter: drop-shadow(0 0 5px hsl(350 90% 55% / 0.85));
}

.danger-title {
  position: relative;
  font-family: ui-monospace, "Courier New", monospace;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #ff2a6d;
  text-shadow: 0 0 8px hsl(350 90% 55% / 0.7), 0 0 2px hsl(350 90% 60% / 0.9);
}

/* Glitch: cyan top-half + red bottom-half offsets that flicker occasionally. */
.danger-title::before,
.danger-title::after {
  content: attr(data-text);
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  pointer-events: none;
  opacity: 0;
}

.danger-title::before {
  color: #05d9e8;
  clip-path: inset(0 0 52% 0);
  animation: dz-glitch-a 3s infinite steps(1);
}

.danger-title::after {
  color: #ff003c;
  clip-path: inset(52% 0 0 0);
  animation: dz-glitch-b 2.7s infinite steps(1);
}

@keyframes dz-glitch-a {
  0%, 92%, 100% { transform: translate(0, 0); opacity: 0; }
  93% { transform: translate(-3px, -1px); opacity: 0.85; }
  96% { transform: translate(2px, 1px); opacity: 0.85; }
}

@keyframes dz-glitch-b {
  0%, 90%, 100% { transform: translate(0, 0); opacity: 0; }
  91% { transform: translate(3px, 1px); opacity: 0.85; }
  95% { transform: translate(-2px, -1px); opacity: 0.85; }
}

.danger-action-title {
  font-weight: 700;
  color: hsl(0 0% 90%);
  margin-bottom: 0.25rem;
}

.danger-action-desc,
:slotted(.danger-action-desc) {
  font-size: 0.85rem;
  color: hsl(350 18% 68%);
  margin-bottom: 1rem;
  max-width: 52ch;
}

:slotted(.danger-btn) {
  display: flex;
  width: 100%;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.7rem 1.1rem;
  color: #ff2a6d;
  background: hsl(350 80% 50% / 0.1);
  border: 1px solid hsl(350 90% 55% / 0.6);
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 0 10px hsl(350 90% 50% / 0.25), inset 0 0 12px hsl(350 90% 50% / 0.08);
  clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px));
}

:slotted(.danger-btn:not(:disabled):hover) {
  background: hsl(350 85% 50% / 0.22);
  color: #fff;
  box-shadow: 0 0 18px hsl(350 90% 55% / 0.6), inset 0 0 18px hsl(350 90% 50% / 0.2);
}

:slotted(.danger-btn:disabled) {
  cursor: not-allowed;
  color: hsl(350 25% 55%);
  border-color: hsl(350 25% 45% / 0.5);
  box-shadow: none;
}

/* Light theme (no .dark on the root): the same hazard language on a pale ground. The dark
   values above are the design; these only replace what would vanish on white. */
:root:not(.dark) .danger-zone-wrap {
  filter: drop-shadow(0 0 12px hsl(350 90% 55% / 0.18));
}

:root:not(.dark) .danger-zone {
  background: linear-gradient(180deg, hsl(350 80% 97%), hsl(350 70% 94%));
  border-color: hsl(350 85% 55% / 0.45);
}

:root:not(.dark) .danger-hazard {
  background: repeating-linear-gradient(-45deg, #e0113d 0, #e0113d 10px, #fbd5de 10px, #fbd5de 20px);
}

:root:not(.dark) .danger-scanlines {
  background: repeating-linear-gradient(
    0deg,
    hsl(350 90% 40% / 0.035) 0,
    hsl(350 90% 40% / 0.035) 1px,
    transparent 1px,
    transparent 3px
  );
}

:root:not(.dark) .danger-icon {
  color: hsl(350 85% 45%);
  filter: drop-shadow(0 0 3px hsl(350 90% 55% / 0.35));
}

:root:not(.dark) .danger-title {
  color: hsl(350 85% 42%);
  text-shadow: none;
}

:root:not(.dark) .danger-title::before {
  color: hsl(190 90% 38%);
}

:root:not(.dark) .danger-action-title {
  color: hsl(350 30% 15%);
}

:root:not(.dark) .danger-action-desc,
:root:not(.dark) :slotted(.danger-action-desc) {
  color: hsl(350 15% 38%);
}

:root:not(.dark) :slotted(.danger-btn) {
  color: hsl(350 85% 42%);
  background: hsl(350 85% 50% / 0.08);
  border-color: hsl(350 85% 50% / 0.55);
  box-shadow: 0 0 8px hsl(350 90% 55% / 0.15), inset 0 0 8px hsl(350 90% 50% / 0.04);
}

:root:not(.dark) :slotted(.danger-btn:not(:disabled):hover) {
  background: hsl(350 85% 48%);
  color: #fff;
  box-shadow: 0 0 14px hsl(350 90% 55% / 0.35);
}

:root:not(.dark) :slotted(.danger-btn:disabled) {
  color: hsl(350 20% 60%);
  border-color: hsl(350 20% 70% / 0.6);
  background: hsl(350 20% 90% / 0.5);
}
</style>
