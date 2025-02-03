<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useVoice } from '@/store/voiceStore';
import { RemoteVideoTrack, Track } from 'livekit-client';
import { Subscription } from 'rxjs';
import { logger } from '@/lib/logger';
import { watch } from 'fs';

const voice = useVoice();


interface Props {
  src: string;
}

const props = defineProps<Props>();

const posX = ref(20); 
const posY = ref(20);
const isDragging = ref(false);
const isFullscreen = ref(false);
let subs: Subscription | null = null;
const videoRef = ref<HTMLMediaElement | null>(null);

(window as any).videoRef = videoRef;



const videoIsActive = ref(false);

function handleVideoCreation(track: RemoteVideoTrack) {
  logger.warn("Handle Video Creation", track, videoRef);
  track.attach(videoRef.value!);
  videoIsActive.value = true;
}
function handleVideoDestroy(track: RemoteVideoTrack) {
  videoIsActive.value = false;
  logger.warn("Handle Video Destroyed", track, videoRef);
  track.detach(videoRef.value!);
}



onMounted(() => {
  subs = voice.onVideoCreated.subscribe(handleVideoCreation as any);
  voice.onVideoDestroyed.subscribe(handleVideoDestroy as any);
});

onUnmounted(() => {
  subs?.unsubscribe();
})

const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value;
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
  <div v-if="props.src" v-on:dblclick="toggleFullscreen" v-show="videoIsActive"
    class="fixed z-50 cursor-move transition-all" :class="{ 'fullscreen': isFullscreen }"
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
      <p>Ваш браузер не поддерживает видео.</p>
    </video>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-64">
      <ContextMenuItem inset>
        Close
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
  top: 2vh !important;
  left: 2vw !important;
  width: 85vw !important;
  height: 85vh !important;
  cursor: default;
}
</style>
