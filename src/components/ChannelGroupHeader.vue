<template>
  <div class="relative px-2 py-1 cursor-pointer group">
    <!-- Divider line -->
    <div class="absolute left-0 right-0 top-1/2 h-px bg-gray-700/50"></div>
    
    <!-- Text and icon on top of divider -->
    <div 
      class="relative inline-flex items-center gap-1.5 px-2 bg-[#161616f5] text-xs font-semibold text-gray-500 uppercase hover:text-gray-300 transition-colors duration-150"
      @click="emit('toggle', group.groupId)"
    >
      <ChevronRightIcon v-if="group.isCollapsed" class="w-3 h-3 transition-transform duration-150" />
      <ChevronDownIcon v-else class="w-3 h-3 transition-transform duration-150" />
      <span class="tracking-wide">{{ group.name }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronRightIcon, ChevronDownIcon } from 'lucide-vue-next';
import type { ChannelGroup } from '@/lib/glue/argonChat';
import type { Guid } from '@argon-chat/ion.webcore';

defineProps<{
  group: ChannelGroup & { isCollapsed: boolean };
}>();

const emit = defineEmits<{
  toggle: [groupId: Guid];
}>();
</script>
