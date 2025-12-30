<template>
  <div
    class="header-list overflow-hidden bg-cover bg-no-repeat bg-center contrast-125 rounded-xl min-h-[8rem]"
    :class="{ 'bg-[#16161655]': !backgroundImage }"
    :style="backgroundImage ? { backgroundImage } : {}"
  >
    <div class="relative p-4 flex justify-between items-center">
      <h2 class="text-lg font-bold relative z-10 text-white">
        {{ spaceName?.name }}
      </h2>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted } from "vue";
import delay from "@/lib/delay";
import { computedAsync } from "@vueuse/core";
import { usePoolStore } from "@/store/poolStore";
import img0 from "@/assets/image0.jpg";

const pool = usePoolStore();


const selectedSpaceId = defineModel<string>('selectedSpace', {
    type: String, required: true
});


const backgroundImage = computed(() => {
    if (selectedSpaceId.value === "11111111-0000-1111-1111-111111111112")
        return `url(${img0})`;
    return '';

})

const spaceName = computedAsync(() => pool.getServer(selectedSpaceId.value))


onMounted(async () => {
  await delay(1000);
});
</script>
