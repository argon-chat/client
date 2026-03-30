<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@argon/ui/context-menu";
import { useLocale } from "@/store/system/localeStore";
import type { RemoteVideoTrack } from "livekit-client";
import type { Subscription } from "rxjs";
import { logger } from "@argon/core";
import { Guid } from "@argon-chat/ion.webcore";
const { t } = useLocale();

const posX = ref(20);
const posY = ref(20);
const isDragging = ref(false);
const isFullscreen = ref(false);
let subs: Subscription | null = null;
const videoRef = ref<HTMLMediaElement | null>(null);

(window as any).videoRef = videoRef;

const videoIsActive = ref(false);

function handleVideoCreation(data: { track: RemoteVideoTrack, userId: Guid }) {
  logger.warn("Handle Video Creation", data.track, videoRef);
  if (videoRef.value) {
    data.track.attach(videoRef.value);
    videoIsActive.value = true;
  }
}
function handleVideoDestroy(data: { track: RemoteVideoTrack, userId: Guid }) {
  videoIsActive.value = false;
  logger.warn("Handle Video Destroyed", data.track, videoRef);
  if (videoRef.value) {
    data.track.detach(videoRef.value);
  }
}

onMounted(() => {
  // TODO: wire up video subscriptions when voice API is ready
});

onUnmounted(() => {
  // TODO: clean up subscriptions when voice API is ready
  subs = null;
});

const toggleFullscreen = () => {
  videoRef.value?.requestFullscreen();
};

const startDrag = (event: MouseEvent) => {
  isDragging.value = true;
  const offsetX = event.clientX - posX.value;
  const offsetY = event.clientY - posY.value;

  const onMouseMove = (moveEvent: MouseEvent) => {
    if (isDragging.value) {
      posX.value = moveEvent.clientX - offsetX;
      posY.value = moveEvent.clientY - offsetY;
    }
  };

  const stopDrag = () => {
    isDragging.value = false;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", stopDrag);
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", stopDrag);
};
</script>

<template>
  <div v-on:dblclick="toggleFullscreen" v-show="videoIsActive"
    class="fixed z-50 cursor-move" :class="{ 'fullscreen': isFullscreen, 'transition-all': !isDragging }"
    :style="isFullscreen 
      ? {} 
      : { top: posY + 'px', left: posX + 'px', width: '350px', height: '185px' }"
    @mousedown="startDrag"
  >
  <ContextMenu>
    <ContextMenuTrigger class="flex items-center justify-center rounded-md border border-dashed text-sm">
      <video ref="videoRef"
      class="w-full h-full rounded-md shadow-md bg-black object-cover"
      autoplay
    >
      <source type="video/mp4" />
      <p>{{t("browser_not_support_video")}}</p>
    </video>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-64">
      <ContextMenuItem inset disabled>
        {{ t("close") }}
        <ContextMenuShortcut>⌘[</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem inset @click="toggleFullscreen">
        {{ isFullscreen ? 'Reduce' : 'Expand'  }}
        <ContextMenuShortcut>🚎</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
    
  </div>
</template>

<style scoped>
.fixed {
  max-width: 100vw;
  max-height: 100vh;
}
.fullscreen {
  position: fixed;
  top: 50%;
  left: 50%;
  width: 100vw;
  height: 100vh;
  transform: translate(-50%, -50%) scale(1);
  object-fit: contain; /* Меняет поведение масштабирования */
  background-color: black;
}
</style>
