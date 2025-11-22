<script setup lang="ts">
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { computed, toRef, type HTMLAttributes } from "vue";
import { useAvatarBlob } from "@/lib/useAvatarBlob";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    fileId: string | null;
    fallback: string;
    serverId?: string;
    userId?: string;
    overridedSize?: number;
  }>(),
  {
    overridedSize: undefined,
  },
);

const fileIdRef = toRef(props, "fileId");
const userIdRef = toRef(props, "userId");

const { loaded, loading, blobSrc } = useAvatarBlob(
  fileIdRef,
  userIdRef,
  "user",
);

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
    <Avatar :class="props.class" :key="props.fileId!" :style="{ width: size, height: size }">
      <Skeleton v-if="loading" :class="props.class" style="height: 100%; width: 100%; background-color: #494949;" />
      <video v-else-if="loaded" playsinline autoplay muted loop :poster="blobSrc" :src="blobSrc" disablePictureInPicture
        controlslist="nodownload nofullscreen noremoteplayback" />
      <AvatarFallback v-else :style="avatarStyle">
        {{ emojiFallback }}
      </AvatarFallback>
    </Avatar>
  </keep-alive>
</template>