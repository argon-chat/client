<script setup lang="ts">
import { Avatar, AvatarFallback } from "@argon/ui/avatar";
import { Skeleton } from "@argon/ui/skeleton";
import { computed, ref, type HTMLAttributes } from "vue";

// Standalone package (no pinia/config access) used in official contexts (overlay). Mirrors the main
// app's by-fileId scheme: the API 302s /files/{fileId} to the nearest regional mirror. Native goes
// through app://cdn (Electron points it at the official API file-redirect).
const isNative = typeof window !== "undefined" && "argonIpc" in window;
function cdnUrl(fileId: string): string {
  if (isNative) return `app://cdn/${fileId}`;
  return `https://api.argon.gl/files/${fileId}`;
}

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    fileId: string | null;
    fallback: string;
    serverId?: string;
    userId?: string;
    spaceId?: string;
    overridedSize?: number;
  }>(),
  {
    overridedSize: undefined,
  },
);

const avatarSrc = computed(() => {
  if (!props.fileId) return null;
  return cdnUrl(props.fileId);
});

const loaded = ref(false);
const loading = computed(() => !!avatarSrc.value && !loaded.value);

const size = computed(() =>
  props.overridedSize ? `${props.overridedSize}px` : null,
);

const isSipUser = computed(() =>
  props.userId?.toLocaleUpperCase()?.startsWith("CFFFFFFF") ?? false
);

const emojiFallback = computed(() =>
  isSipUser.value
    ? "📞"
    : props.fallback.at(0)?.toUpperCase()
);

const avatarStyle = computed(() => {
  if (!isSipUser.value) return {};
  return {
    backgroundColor: "#ff8b00",
    color: "white",
  };
});
</script>

<template>
  <keep-alive :max="10" :key="props.fileId!">
    <Avatar :class="['!bg-transparent', props.class]" :key="props.fileId!" :style="{ width: size, height: size, ...avatarStyle }">
      <Skeleton v-if="loading && !loaded" :class="props.class" style="height: 100%; width: 100%; background-color: #494949;" />
      <img v-else-if="avatarSrc" :src="avatarSrc" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;" @load="loaded = true" />
      <AvatarFallback v-else>
        {{ emojiFallback }}
      </AvatarFallback>
    </Avatar>
  </keep-alive>
</template>
