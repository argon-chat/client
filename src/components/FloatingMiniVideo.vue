<script setup lang="ts">
import { ref } from 'vue';

interface Props {
  src: string;
}

const props = defineProps<Props>();

const posX = ref(20); 
const posY = ref(20);
const isDragging = ref(false);

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
  <div v-if="props.src"
    class="fixed z-50 cursor-move"
    :style="{ top: posY + 'px', left: posX + 'px', width: '150px', height: '85px' }"
    @mousedown="startDrag"
  >
    <video :src="props.src"
      class="w-full h-full rounded-md shadow-md bg-black object-cover"
      autoplay
      muted
      controls
    >
      <source :src="src" type="video/mp4" />
      <p>Ваш браузер не поддерживает видео.</p>
    </video>
  </div>
</template>

<style scoped>
.fixed {
  max-width: 100vw;
  max-height: 100vh;
}
</style>