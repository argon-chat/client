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
</script>

<template>
  <keep-alive :max="10" :key="props.fileId!">
    <Avatar :class="props.class" :key="props.fileId!" :style="{ width: size, height: size }">
      <Skeleton v-if="loading" :class="props.class" style="height: 100%; width: 100%; background-color: #494949;" />
      <AvatarImage v-else-if="loaded" :src="blobSrc" />
      <AvatarFallback v-else>{{ props.fallback.at(0)?.toUpperCase() }}</AvatarFallback>
    </Avatar>
  </keep-alive>
</template>