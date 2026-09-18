<script setup lang="ts">
import type { ArgonUserProfile } from "@argon/glue";
import CosmeticBadges from "@/cosmetics/CosmeticBadges.vue";

/**
 * The labelled badge chips on a profile page.
 *
 * Kept as its own component because the chips are a different shape from the bare icons beside a
 * username, but the badges themselves are now decided in one place. This used to hold its own
 * hardcoded list of three — premium, staff, contributor — which was not the same three the popover
 * drew, so a space owner never saw their owner badge here.
 */
defineProps<{
  profile: ArgonUserProfile | null | undefined;
  flags?: number;
}>();
</script>

<template>
  <CosmeticBadges :profile="profile" :flags="flags" variant="chips" />
</template>
