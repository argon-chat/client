<script setup lang="ts">
/**
 * What the app shows when a render throws instead of a blank or half-drawn window.
 *
 * A render error in some screen is usually recoverable: the rest of the app (sockets, stores) is
 * fine, so the user may continue (the subtree renders again) or reload. The details are folded away
 * and can be copied for a bug report.
 *
 * A native panic is different. vue-native throws `native panic at …` into JS and then stops running
 * JS for good (its runtime is poisoned), so no button here could ever do anything; the host shows
 * its own crash dialog with a real restart. This only says what happened, without dead buttons.
 */
import { computed, ref, onErrorCaptured } from "vue";
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon } from "lucide-vue-next";
import { logger } from "@argon/core";
import { Button } from "@argon/ui/button";
import { useLocale } from "@/store/system/localeStore";

const hasError = ref(false);
const message = ref("");
const stack = ref("");
const detailsOpen = ref(false);
const copied = ref(false);

/** The locale store may be what broke: fall back to English rather than throw again. */
const FALLBACK: Record<string, string> = {
  error_boundary_title: "Something went wrong",
  error_boundary_body: "This part of the app could not be shown. You can carry on, or reload the app.",
  error_boundary_native_title: "The app has stopped",
  error_boundary_native_body: "An internal error stopped the app. Use the dialog in front of this window to restart it.",
  error_boundary_reload: "Reload",
  error_boundary_continue: "Continue",
  error_boundary_details: "Details",
  error_boundary_copy: "Copy",
  error_boundary_copied: "Copied",
};
let translate: (key: string) => string = (key) => FALLBACK[key] ?? key;
try {
  const { t } = useLocale();
  translate = (key) => {
    try {
      const text = t(key);
      return text && text !== key ? text : (FALLBACK[key] ?? key);
    } catch {
      return FALLBACK[key] ?? key;
    }
  };
} catch {
  /* keep the fallback */
}

const native = computed(() => message.value.startsWith("native panic at "));
const report = computed(() => [message.value, stack.value].filter(Boolean).join("\n\n"));

onErrorCaptured((err) => {
  hasError.value = true;
  message.value = err instanceof Error ? err.message : String(err);
  stack.value = err instanceof Error ? (err.stack ?? "") : "";
  detailsOpen.value = false;
  copied.value = false;
  logger.error("[error-boundary] captured render error:", err);
  return false; // stop propagation past the boundary
});

function reload() {
  location.reload();
}

function dismiss() {
  hasError.value = false;
  message.value = "";
  stack.value = "";
}

async function copyReport() {
  try {
    await navigator.clipboard.writeText(report.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch (err) {
    logger.warn("[error-boundary] could not copy the report:", err);
  }
}
</script>

<template>
  <slot v-if="!hasError" />

  <!-- Portalled: vue-native lays a `fixed` box out against its parent (v1), and the parent here is
       the app's empty root, so in place the card was centred on a 48 px strip and cut in half. -->
  <Teleport v-else to="body">
    <div class="eb-overlay" role="alertdialog" aria-modal="true" aria-labelledby="eb-title">
      <div class="eb-card">
        <div class="eb-icon">
          <AlertTriangleIcon class="h-6 w-6" />
        </div>

        <h2 id="eb-title" class="eb-title">
          {{ translate(native ? "error_boundary_native_title" : "error_boundary_title") }}
        </h2>
        <p class="eb-body">
          {{ translate(native ? "error_boundary_native_body" : "error_boundary_body") }}
        </p>

        <template v-if="!native && message">
          <button type="button" class="eb-details-toggle" :aria-expanded="detailsOpen" @click="detailsOpen = !detailsOpen">
            <ChevronUpIcon v-if="detailsOpen" class="h-4 w-4" />
            <ChevronDownIcon v-else class="h-4 w-4" />
            {{ translate("error_boundary_details") }}
          </button>
          <div v-if="detailsOpen" class="eb-details">
            <pre class="eb-details-text">{{ report }}</pre>
            <button type="button" class="eb-copy" @click="copyReport">
              <CheckIcon v-if="copied" class="h-3.5 w-3.5" />
              <CopyIcon v-else class="h-3.5 w-3.5" />
              {{ translate(copied ? "error_boundary_copied" : "error_boundary_copy") }}
            </button>
          </div>
        </template>

        <div v-if="!native" class="eb-actions">
          <Button variant="secondary" @click="dismiss">{{ translate("error_boundary_continue") }}</Button>
          <Button variant="default" @click="reload">{{ translate("error_boundary_reload") }}</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.eb-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: hsl(var(--background) / 0.86);
  backdrop-filter: blur(12px);
}

.eb-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 440px;
  padding: 28px 28px 24px;
  text-align: center;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: calc(var(--radius) + 4px);
  background: hsl(var(--card));
  box-shadow: 0 24px 64px hsl(0 0% 0% / 0.35);
}

.eb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  border-radius: 9999px;
  background: hsl(var(--destructive) / 0.14);
  color: hsl(var(--destructive));
}

.eb-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.4;
  color: hsl(var(--foreground));
}

.eb-body {
  margin: 6px 0 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: hsl(var(--muted-foreground));
}

.eb-details-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 16px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 0.8125rem;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
}

.eb-details-toggle:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--accent) / 0.6);
}


.eb-details {
  position: relative;
  width: 100%;
  margin-top: 8px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: var(--radius);
  background: hsl(var(--muted) / 0.5);
  text-align: left;
}

.eb-details-text {
  max-height: 160px;
  margin: 0;
  padding: 10px 12px 34px;
  overflow: auto;
  font-family: ui-monospace, "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  color: hsl(var(--foreground) / 0.85);
  white-space: pre-wrap;
  word-break: break-word;
}

.eb-copy {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: 6px;
  background: hsl(var(--card));
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
}

.eb-copy:hover {
  color: hsl(var(--foreground));
}

.eb-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 22px;
}
</style>
