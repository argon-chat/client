<script setup lang="ts">
// Unified avatar component: supports both direct fileId and userId-based auto-fetch
import { Avatar, AvatarFallback } from "@argon/ui/avatar";
import { Skeleton } from "@argon/ui/skeleton";
import { computed, ref, toRef, watch, type HTMLAttributes } from "vue";
import { cdnUrl } from "@/store/system/fileStorage";
import { useUserColors } from "@/store/chat/userColors";
import { usePoolStore } from "@/store/data/poolStore";

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

const userColors = useUserColors();
const pool = usePoolStore();

// --- Smart mode: when only userId is provided (no fileId) ---
const isSmartMode = computed(() => props.userId && props.fileId === undefined);
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
  if (!avatarFileId.value) return null;
  return cdnUrl(avatarFileId.value);
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
  <keep-alive :max="10" :key="fileId ?? userId ?? ''">
    <Avatar :class="[props.class]" :key="fileId ?? userId ?? ''" :style="{ width: size, height: size, ...avatarRootStyle }">
      <img v-if="avatarSrc && !imgFailed" :src="avatarSrc" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;" @load="loaded = true" @error="onImgError" />
      <AvatarFallback v-else>
        {{ fallbackLetter }}
      </AvatarFallback>
    </Avatar>
  </keep-alive>
</template>