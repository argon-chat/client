<script setup lang="ts">
// Unified avatar component: supports both direct fileId and userId-based auto-fetch
import { Avatar, AvatarFallback, AvatarImage } from "@argon/ui/avatar";
import { Skeleton } from "@argon/ui/skeleton";
import { computed, ref, toRef, watch, type HTMLAttributes } from "vue";
import { useAvatarBlob } from "@argon/avatar";
import { useFileStorage } from "@/store/system/fileStorage";
import { useUserColors } from "@/store/chat/userColors";
import { usePoolStore } from "@/store/data/poolStore";
import { logger } from "@argon/core";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    fileId?: string | null;
    fallback?: string;
    serverId?: string;
    userId?: string;
    spaceId?: string;
    overridedSize?: number | 'auto';
  }>(),
  {
    fileId: undefined,
    fallback: undefined,
    overridedSize: undefined,
  },
);

const fileStorage = useFileStorage();
const userColors = useUserColors();
const pool = usePoolStore();

// --- Smart mode: when only userId is provided (no fileId) ---
const isSmartMode = computed(() => props.userId && props.fileId === undefined);
const user = isSmartMode.value ? pool.getUserReactive(toRef(props, "userId")) : ref(null);

const smartLoading = ref(isSmartMode.value);
const smartLoaded = ref(false);
const smartBlobSrc = ref("");
const smartFallbackLetter = ref("?");

const isCallUser = computed(() =>
  props.userId?.toLocaleUpperCase()?.startsWith("CFFFFFFF") ?? false
);

const isGuestUser = computed(() =>
  props.userId?.toLowerCase()?.startsWith("fafccccc") ?? false
);

const isSipUser = computed(() => isCallUser.value);

if (isSmartMode.value) {
  watch(
    () => user.value?.avatarFileId,
    async (fileId) => {
      smartLoading.value = true;
      smartLoaded.value = false;

      if (!fileId) {
        smartBlobSrc.value = fileStorage.FAILED_ADDRESS;
        smartFallbackLetter.value =
          user.value?.displayName?.at(0)?.toUpperCase() ?? "?";
        smartLoading.value = false;
        return;
      }

      try {
        smartFallbackLetter.value = isGuestUser.value
          ? "👤"
          : isCallUser.value
            ? "📞"
            : (user.value?.displayName?.at(0)?.toUpperCase() ?? "?");

        const src = await fileStorage.fetchUserAvatar(fileId, props.userId!);
        smartBlobSrc.value = src;
        smartLoaded.value = src !== fileStorage.FAILED_ADDRESS;
      } catch (e) {
        logger.error("Error loading avatar:", e);
        smartBlobSrc.value = fileStorage.FAILED_ADDRESS;
        smartFallbackLetter.value = isGuestUser.value ? "👤" : isCallUser.value ? "📞" : "?";
        smartLoaded.value = false;
      } finally {
        smartLoading.value = false;
      }
    },
    { immediate: true },
  );
}

// --- Direct mode: when fileId is provided ---
const fileIdRef = toRef(props, "fileId");

const ownerId = computed(() => {
  if (props.spaceId) return props.spaceId;
  if (props.userId) return props.userId;
  if (props.serverId) return props.serverId;
  return null;
});

const avatarType = computed<"user" | "server">(() => {
  if (props.spaceId || props.serverId) return "server";
  return "user";
});

const directBlob = !isSmartMode.value
  ? useAvatarBlob(fileIdRef, ownerId, avatarType, fileStorage)
  : { loaded: ref(false), loading: ref(false), blobSrc: ref("") };

// --- Unified API ---
const loading = computed(() => isSmartMode.value ? smartLoading.value : directBlob.loading.value);
const loaded = computed(() => isSmartMode.value ? smartLoaded.value : directBlob.loaded.value);
const blobSrc = computed(() => isSmartMode.value ? smartBlobSrc.value : directBlob.blobSrc.value);

const size = computed(() =>
  props.overridedSize ? (props.overridedSize === 'auto' ? 'auto' : `${props.overridedSize}px`) : null,
);

const fallbackLetter = computed(() => {
  if (isSmartMode.value) return smartFallbackLetter.value;
  if (isSipUser.value) return "📞";
  return props.fallback?.at(0)?.toUpperCase() ?? "?";
});

const avatarRootStyle = computed(() => {
  if (loading.value || loaded.value) {
    // For smart mode: show colored bg for guest/call users even when loading
    if (isSmartMode.value) {
      if (isGuestUser.value) return { backgroundColor: "#8b5cf6", color: "white" };
      if (isCallUser.value) return { backgroundColor: "#ff8b00", color: "white" };
    }
    return {};
  }

  // Fallback colors
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
  <keep-alive :max="10" :key="fileId ?? userId ?? ''">
    <Avatar :class="[props.class]" :key="fileId ?? userId ?? ''" :style="{ width: size, height: size, ...avatarRootStyle }">
      <Skeleton v-if="loading" :class="props.class" style="height: 100%; width: 100%; background-color: #494949;" />
      <video v-else-if="loaded" playsinline autoplay muted loop :poster="blobSrc" :src="blobSrc" disablePictureInPicture
        controlslist="nodownload nofullscreen noremoteplayback" />
      <AvatarFallback v-else>
        {{ fallbackLetter }}
      </AvatarFallback>
    </Avatar>
  </keep-alive>
</template>