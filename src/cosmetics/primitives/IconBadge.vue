<script setup lang="ts">
import { computed } from "vue";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@argon/ui/tooltip";
import { cdnUrl } from "@/store/system/fileStorage";
import { useLocale } from "@/store/system/localeStore";
import { argbToRgb } from "@/lib/profileCustomization";
import type { BadgePayload } from "@/cosmetics/kinds/profile-badge";
import type { ResolvedCosmetic } from "@/cosmetics/types";

const props = defineProps<{ item: ResolvedCosmetic; size?: number }>();

const { t } = useLocale();

const payload = computed(() => props.item.payload as BadgePayload);

const src = computed(() => {
  const fileId = props.item.assets.Primary;
  return fileId ? cdnUrl(fileId) : null;
});

const style = computed(() => ({
  width: `${props.size ?? 16}px`,
  height: `${props.size ?? 16}px`,
  ...(payload.value.tint !== null ? { backgroundColor: argbToRgb(payload.value.tint) } : {}),
}));

// A badge whose key has no translation would render the raw key as a tooltip, which reads like a
// bug to the person hovering it. The slug is a worse label but an honest one.
const label = computed(() => {
  const translated = t(payload.value.tooltipKey);
  return translated === payload.value.tooltipKey ? props.item.slug : translated;
});
</script>

<template>
  <TooltipProvider v-if="src">
    <Tooltip>
      <TooltipTrigger as-child>
        <img class="cosmetic-icon-badge" :src="src" :style="style" :alt="label" draggable="false" />
      </TooltipTrigger>
      <TooltipContent>{{ label }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<style scoped>
.cosmetic-icon-badge {
  display: inline-block;
  object-fit: contain;
  vertical-align: middle;
}
</style>
