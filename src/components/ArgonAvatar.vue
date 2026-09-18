<script setup lang="ts">
// Unified avatar component: supports both direct fileId and userId-based auto-fetch
import { Avatar, AvatarFallback } from "@argon/ui/avatar";
import { Skeleton } from "@argon/ui/skeleton";
import { computed, ref, toRef, watch, type HTMLAttributes } from "vue";
import { cdnUrl } from "@/store/system/fileStorage";
import { useUserColors } from "@/store/chat/userColors";
import { usePoolStore } from "@/store/data/poolStore";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import CosmeticSurface from "@/cosmetics/CosmeticSurface.vue";
import type { ArgonUserProfile } from "@argon/glue";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    /** An already-resolved image URL (a cached data URL, say). Wins over fileId/userId lookup. */
    src?: string | null;
    fileId?: string | null;
    fallback?: string;
    serverId?: string;
    userId?: string;
    spaceId?: string;
    overridedSize?: number | 'auto';
    /**
     * The profile to take an avatar decoration from, when the caller already has one.
     *
     * Passed rather than looked up on purpose. An avatar that resolved its own decoration would put
     * a profile read behind every avatar on screen, and the place that renders the most of them is a
     * member list — so the cheap default is "no decoration" and a caller that has the profile in
     * hand opts in by handing it over.
     */
    profile?: ArgonUserProfile | null;

    /**
     * Draws the face and nothing else.
     *
     * For the places that show an account rather than a person as they appear somewhere: the account
     * switcher is the case this exists for. A decoration belongs to a look, and a look belongs to a
     * space — putting one on a row that is about which account you are signed into says the row is
     * about the persona instead.
     */
    plain?: boolean;
  }>(),
  {
    fileId: undefined,
    fallback: undefined,
    overridedSize: undefined,
    profile: null,
  },
);

const userColors = useUserColors();
const pool = usePoolStore();

// --- Smart mode: when only userId is provided (no fileId) ---
const isSmartMode = computed(() => props.userId && props.fileId === undefined && !props.src);
const user = isSmartMode.value ? pool.getUserReactive(toRef(props, "userId")) : ref(null);

const isCallUser = computed(() =>
  props.userId?.toLocaleUpperCase()?.startsWith("CFFFFFFF") ?? false
);

const isGuestUser = computed(() =>
  props.userId?.toLowerCase()?.startsWith("fafccccc") ?? false
);

const isSipUser = computed(() => isCallUser.value);

// --- Build avatar src directly from fileId ---
const avatarFileId = computed(() => {
  if (isSmartMode.value) return user.value?.avatarFileId ?? null;
  return props.fileId ?? null;
});

const avatarSrc = computed(() => {
  if (props.src) return props.src;
  if (!avatarFileId.value) return null;
  return cdnUrl(avatarFileId.value);
});

const cosmetics = useCosmeticsStore();

/**
 * The decoration, from whichever source the caller can afford.
 *
 * A profile when the caller holds one; otherwise the store's batch, which a list fills for its whole
 * window in one call. Neither fetches — an avatar that went looking for its own decoration would put
 * a request behind every face in a member list.
 */
const decorations = computed(() => {
  if (props.plain) return [];

  return props.profile
    ? cosmetics.resolve(props.profile, "avatar")
    : props.userId
      ? cosmetics.wornBy(props.spaceId, props.userId, "avatar")
      : [];
});

// Two accounts can be the same person on different instances — same userId, different picture — so
// a pre-resolved src has to take part in the identity of the cached tile, not just the file id.
//
// The decoration takes part too, and it has to: the tile is kept alive across re-renders, so a
// decoration put on or taken off would otherwise keep showing the one that was cached with it.
const cacheKey = computed(() => {
  const worn = decorations.value.map(item => item.itemId).join(",");
  const identity = props.fileId ?? props.src?.slice(-32) ?? props.userId ?? "";

  return worn ? `${identity}:${worn}` : identity;
});

const loaded = ref(false);
const loading = computed(() => !!avatarFileId.value && !loaded.value);

// Reset loaded state when src changes
watch(avatarSrc, () => { loaded.value = false; imgFailed.value = false; });

const imgFailed = ref(false);
function onImgError() {
  imgFailed.value = true;
  loaded.value = false;
}

const size = computed(() =>
  props.overridedSize ? (props.overridedSize === 'auto' ? 'auto' : `${props.overridedSize}px`) : null,
);

const fallbackLetter = computed(() => {
  if (isSmartMode.value) {
    if (isGuestUser.value) return "👤";
    if (isCallUser.value) return "📞";
    return user.value?.displayName?.at(0)?.toUpperCase() ?? "?";
  }
  if (isSipUser.value) return "📞";
  return props.fallback?.at(0)?.toUpperCase() ?? "?";
});

const avatarRootStyle = computed(() => {
  if (loading.value || loaded.value) {
    if (isSmartMode.value) {
      if (isGuestUser.value) return { backgroundColor: "#8b5cf6", color: "white" };
      if (isCallUser.value) return { backgroundColor: "#ff8b00", color: "white" };
    }
    return {};
  }

  if (isGuestUser.value) return { backgroundColor: "#8b5cf6", color: "white" };
  if (isCallUser.value || isSipUser.value) return { backgroundColor: "#ff8b00", color: "white" };

  const baseColor = props.userId || props.spaceId || props.serverId;
  const backgroundColor = baseColor
    ? userColors.getColorByUserId(baseColor)
    : "#494949";

  return { backgroundColor, color: "white" };
});
</script>

<template>
  <!--
    relative and overflow-visible only while decorated.

    A decoration is positioned against the avatar and is usually meant to sit outside its shape, so
    it needs the avatar to be the thing it resolves against. The shared avatar is not positioned, so
    without this the decoration climbed to whatever ancestor happened to be — a message row, a
    popover — and came out centred on that, at that thing's height.

    Nothing is added to the DOM for an undecorated avatar, which is every avatar whose caller passes
    no profile.

    The comment lives out here because <keep-alive> counts a comment as a child and refuses to have
    more than one.
  -->
  <keep-alive :max="10" :key="cacheKey">
    <Avatar
      :class="[props.class, decorations.length ? 'relative overflow-visible' : undefined]"
      :key="cacheKey"
      :style="{ width: size, height: size, ...avatarRootStyle }"
    >
      <img v-if="avatarSrc && !imgFailed" crossorigin="anonymous" :src="avatarSrc" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;" @load="loaded = true" @error="onImgError" />
      <AvatarFallback v-else>
        {{ fallbackLetter }}
      </AvatarFallback>
      <CosmeticSurface
        v-if="decorations.length"
        surface="avatar"
        :profile="props.profile"
        :user-id="props.userId"
        :space-id="props.spaceId"
      />
    </Avatar>
  </keep-alive>
</template>