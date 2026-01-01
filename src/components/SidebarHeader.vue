<template>
  <div class="header-list overflow-hidden bg-cover bg-no-repeat bg-center contrast-125 rounded-xl min-h-[8rem]"
    :class="{ 'bg-[#16161655]': !backgroundImage }" :style="backgroundImage ? { backgroundImage } : {}">
    <div class="relative flex flex-col items-start">
      <div class="w-full relative">
        <div class="h-10 bg-gradient-to-b from-black/80 to-transparent rounded-t-lg" />
        <div class="absolute inset-0 flex items-start pt-1.5">
          <h2 class="text-lg font-bold text-white text-shadow-lg px-4 flex items-center gap-2">
            <TooltipProvider v-if="isVerifiedSpace">
              <Tooltip>
                <TooltipTrigger as-child>
                  <span class="relative group">
                    <PhSealCheck
                      class="w-6 h-6 text-yellow-400 cursor-pointer transition-all duration-500 group-hover:rotate-[360deg] group-hover:scale-110 group-hover:drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                      weight="fill" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" class="bg-gray-900 text-white px-2 py-1 rounded text-sm">
                  Verified Space!
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {{ spaceName?.name }}
          </h2>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted } from "vue";
import delay from "@/lib/delay";
import { computedAsync } from "@vueuse/core";
import { usePoolStore } from "@/store/poolStore";
import img0 from "@/assets/image0.jpg";
import { PhSealCheck } from "@phosphor-icons/vue";
import Tooltip from "./ui/tooltip/Tooltip.vue";
import TooltipProvider from "./ui/tooltip/TooltipProvider.vue";
import TooltipTrigger from "./ui/tooltip/TooltipTrigger.vue";
import TooltipContent from "./ui/tooltip/TooltipContent.vue";

const pool = usePoolStore();


const selectedSpaceId = defineModel<string>('selectedSpace', {
  type: String, required: true
});


const isVerifiedSpace = computed(() => {
  return selectedSpaceId.value === "11111111-0000-1111-1111-111111111112";
})

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
