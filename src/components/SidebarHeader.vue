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
import { usePoolStore } from "@/store/poolStore";
import delay from "@/lib/delay";
import { computedAsync } from "@vueuse/core";

const pool = usePoolStore();


const selectedSpaceId = defineModel<string>('selectedSpace', {
    type: String, required: true
});


const backgroundImage = computed(() => {
    if (selectedSpaceId.value === "11111111-0000-1111-1111-111111111112")
        return 'url(https://i.ppy.sh/f3bd9efc54c8464c7cfba57e7a8b8b6953444175/68747470733a2f2f612d7374617469632e62657374686477616c6c70617065722e636f6d2f6461726c696e672d64616e732d6c652d6672616e78782d7a65726f2d74776f2d666f6e642d642d656372616e2d32353630783936302d33333638395f38372e6a7067)';
    return '';

})

const spaceName = computedAsync(() => pool.getServer(selectedSpaceId.value))


onMounted(async () => {
  await delay(1000);
});
</script>
