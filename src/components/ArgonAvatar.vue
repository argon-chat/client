<script setup lang="ts">
// Re-export from @argon/avatar with app-specific file storage
import { Avatar, AvatarFallback, AvatarImage } from "@argon/ui/avatar";
import { Skeleton } from "@argon/ui/skeleton";
import { computed, toRef, type HTMLAttributes } from "vue";
import { useAvatarBlob } from "@argon/avatar";
import { useFileStorage } from "@/store/fileStorage";
import { useUserColors } from "@/store/userColors";

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

const fileIdRef = toRef(props, "fileId");
const userIdRef = toRef(props, "userId");
const spaceIdRef = toRef(props, "spaceId");

// Determine the owner ID and type based on what's provided
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

const fileStorage = useFileStorage();
const userColors = useUserColors();

const { loaded, loading, blobSrc } = useAvatarBlob(
  fileIdRef,
  ownerId,
  avatarType,
  fileStorage,
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
  // Показываем цветной фон только для фоллбека (когда нет изображения)
  if (loading.value || loaded.value) {
    return {};
  }
  
  const baseColor = props.userId || props.spaceId || props.serverId;
  const backgroundColor = baseColor 
    ? userColors.getColorByUserId(baseColor)
    : "#494949";
  
  if (isSipUser.value) {
    return {
      backgroundColor: "#ff8b00",
      color: "white",
    };
  }
  
  return {
    backgroundColor,
    color: "white",
  };
});
</script>

<template>
  <keep-alive :max="10" :key="props.fileId!">
    <Avatar :class="[props.class]" :key="props.fileId!" :style="{ width: size, height: size, ...avatarStyle }">
      <Skeleton v-if="loading" :class="props.class" style="height: 100%; width: 100%; background-color: #494949;" />
      <video v-else-if="loaded" playsinline autoplay muted loop :poster="blobSrc" :src="blobSrc" disablePictureInPicture
        controlslist="nodownload nofullscreen noremoteplayback" />
      <AvatarFallback v-else>
        {{ emojiFallback }}
      </AvatarFallback>
    </Avatar>
  </keep-alive>
</template>