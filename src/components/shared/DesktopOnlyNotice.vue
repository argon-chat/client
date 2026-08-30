<script setup lang="ts">
/**
 * Stands in for a feature the browser build cannot provide.
 *
 * Shown instead of the real settings panel rather than hiding the panel outright: a hotkeys tab that
 * simply is not there reads as a missing feature, while an empty one reads as a broken app. This
 * says which it is and where the full version lives.
 */
import { MonitorDownIcon } from "lucide-vue-next";
import { Button } from "@argon/ui/button";
import { DOWNLOAD_URL } from "@/lib/platform";
import { useLocale } from "@/store/system/localeStore";

const props = defineProps<{
  /** Locale key for the heading — usually the feature's own name. */
  title?: string;
  /** Locale key for the explanation. Defaults to the generic "desktop only" line. */
  description?: string;
  /** Renders without the outer card, for embedding inside an existing section. */
  inline?: boolean;
}>();

const { t } = useLocale();

function openDownload() {
  window.open(DOWNLOAD_URL, "_blank", "noopener");
}
</script>

<template>
  <div class="desktop-only" :class="{ 'is-inline': props.inline }">
    <div class="icon-wrap">
      <MonitorDownIcon class="w-6 h-6" />
    </div>
    <div class="min-w-0 flex-1">
      <h3 class="text-base font-semibold leading-6 text-white">
        {{ t(props.title ?? "desktop_only_title") }}
      </h3>
      <p class="mt-1 text-sm leading-5 text-muted-foreground">
        {{ t(props.description ?? "desktop_only_desc") }}
      </p>
    </div>
    <Button variant="default" class="shrink-0" @click="openDownload">
      {{ t("desktop_only_download") }}
    </Button>
  </div>
</template>

<style scoped>
.desktop-only {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  border: 1px solid hsl(var(--border) / 0.6);
  border-radius: var(--radius);
  background: hsl(var(--card) / var(--card-alpha));
}

.desktop-only.is-inline {
  padding: 14px 16px;
  background: transparent;
}

.icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}
</style>
