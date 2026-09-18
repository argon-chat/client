<script setup lang="ts">
import { computed } from "vue";
import { Badge } from "@argon/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@argon/ui/tooltip";
import { CrownIcon } from "lucide-vue-next";
import { IconDiamondFilled } from "@tabler/icons-vue";
import IconCat from "@argon/assets/icons/icon_cat.svg";
import IconCpu from "@argon/assets/icons/icon_gpu_04.svg";
import { UserFlag, type ArgonUserProfile } from "@argon/glue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { useLocale } from "@/store/system/localeStore";
import IconBadge from "@/cosmetics/primitives/IconBadge.vue";

/**
 * Every badge a person wears, from one place.
 *
 * There were two of these, and they disagreed: the profile popover drew owner, staff, contributor
 * and a premium mark taken from the user's flags, while the profile page drew premium, staff and
 * contributor and had never heard of owner. Same data, two incomplete mappings — so a space owner
 * looking at their own profile page could not see the badge that everybody else saw on their card.
 *
 * The two shapes are kept, because they are genuinely different: bare icons beside a username,
 * labelled chips on a profile page. What is unified is which badges exist.
 */
const props = withDefaults(
  defineProps<{
    profile: ArgonUserProfile | null | undefined;
    flags?: number;
    variant?: "icons" | "chips";
  }>(),
  { flags: 0, variant: "icons" },
);

const cosmetics = useCosmeticsStore();
const { t } = useLocale();

/**
 * Badges that exist as catalogue cosmetics — the path everything new arrives through.
 *
 * Filtered to the badge renderer because a profile card carries more than badges: the background
 * claims the same surface, and drawing it here would put a video clip in the name row.
 */
const worn = computed(() =>
  cosmetics.resolve(props.profile, "profileCard").filter(item => item.kind.primitive === "iconBadge"),
);

/**
 * The hardcoded badges, which are still how the three original ones reach a client.
 *
 * Granting one writes a string into the profile's badge array through the inventory path; nothing
 * has moved to the catalogue yet, and this keeps working until something does. A slug already drawn
 * as a cosmetic is skipped so the same badge cannot appear twice during that overlap.
 */
const LEGACY = {
  owner: { icon: CrownIcon, class: "fill-blue-400 text-yellow-400", key: "badge_owner" },
  staff: { icon: IconCat, class: "fill-purple-400", key: "badge_staff" },
  contributor: { icon: IconCpu, class: "fill-yellow-400", key: "badge_contributor" },
  premium: { icon: IconDiamondFilled, class: "text-violet-400", key: "badge_premium" },
} as const;

type LegacyBadge = keyof typeof LEGACY;

const legacy = computed<LegacyBadge[]>(() => {
  const drawn = new Set(worn.value.map(item => item.slug));
  const found: LegacyBadge[] = [];

  const carried = new Set(props.profile?.badges ?? []);

  // Premium is the one badge with two sources: a string in the badge array, and the flag on the
  // user. The popover read the flag, the profile page read the string, and both are true of a
  // subscriber — so either counts.
  if ((props.flags & UserFlag.PREMIUM) !== 0) carried.add("premium");

  for (const slug of Object.keys(LEGACY) as LegacyBadge[]) {
    if (carried.has(slug) && !drawn.has(slug)) found.push(slug);
  }

  return found;
});
</script>

<template>
  <template v-if="variant === 'icons'">
    <IconBadge v-for="item in worn" :key="item.itemId" :item="item" :size="16" />

    <TooltipProvider
      v-for="slug in legacy"
      :key="slug"
      :delay-duration="300"
      :ignore-non-keyboard-focus="true"
    >
      <Tooltip>
        <TooltipTrigger>
          <component :is="LEGACY[slug].icon" class="badge-icon" :class="LEGACY[slug].class" />
        </TooltipTrigger>
        <TooltipContent>
          <p>{{ t(LEGACY[slug].key) }}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </template>

  <template v-else>
    <Badge v-for="item in worn" :key="item.itemId" variant="secondary" class="flex items-center gap-1">
      <IconBadge :item="item" :size="16" />
      {{ t(item.kind.labelKey) }}
    </Badge>

    <Badge v-for="slug in legacy" :key="slug" variant="secondary" class="flex items-center gap-1">
      <component :is="LEGACY[slug].icon" class="w-4 h-4 align-middle" :class="LEGACY[slug].class" />
      {{ t(LEGACY[slug].key) }}
    </Badge>
  </template>
</template>

<style scoped>
.badge-icon {
  width: 0.9rem;
  height: 0.9rem;
  vertical-align: middle;
}
</style>
