<template>
  <TooltipProvider v-if="badges.length" :delayDuration="200">
    <Tooltip v-for="badge in badges" :key="badge.key">
      <TooltipTrigger as-child>
        <span class="space-badge group" :style="{ width: `${size}px`, height: `${size}px` }">
          <component
            :is="badge.icon"
            weight="fill"
            class="space-badge-icon"
            :class="badge.iconClass"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {{ badge.label }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<script setup lang="ts">
/**
 * The tags a space carries next to its name: Official, Verified and Community.
 *
 * Official and Verified are mutually exclusive by presentation — a space that is both shows only
 * Official, the stronger of the two — while Community is orthogonal and sits alongside either.
 * All three come straight off the space row; nothing here decides who gets one.
 */
import { computed, type Component } from "vue";
import { PhSealCheck, PhUsersThree } from "@phosphor-icons/vue";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@argon/ui/tooltip";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();

const props = withDefaults(
  defineProps<{
    isOfficial?: boolean | null;
    isVerified?: boolean | null;
    isCommunity?: boolean | null;
    /** Icon box in px — the header wants 24, a preview card 16. */
    size?: number;
  }>(),
  { isOfficial: false, isVerified: false, isCommunity: false, size: 16 },
);

const badges = computed(() => {
  const out: { key: string; icon: Component; iconClass: string; label: string }[] = [];
  if (props.isOfficial)
    out.push({
      key: "official",
      icon: PhSealCheck,
      iconClass: "text-sky-400 group-hover:drop-shadow-[0_0_8px_rgba(56,189,248,0.85)]",
      label: t("space_badge_official"),
    });
  else if (props.isVerified)
    out.push({
      key: "verified",
      icon: PhSealCheck,
      iconClass: "text-yellow-400 group-hover:drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]",
      label: t("space_badge_verified"),
    });
  if (props.isCommunity)
    out.push({
      key: "community",
      icon: PhUsersThree,
      iconClass: "text-emerald-400 group-hover:drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]",
      label: t("space_badge_community"),
    });
  return out;
});
</script>

<style scoped>
.space-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
}

.space-badge-icon {
  width: 100%;
  height: 100%;
  transition: transform 0.5s ease, filter 0.3s ease;
}

.space-badge:hover .space-badge-icon {
  transform: rotate(360deg) scale(1.1);
}
</style>
