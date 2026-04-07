<template>
  <div 
    class="group-header"
    :data-drag-over="isDragOver || undefined"
    @dragover.prevent="emit('group-dragover', group.groupId, $event)"
    @dragleave="emit('group-dragleave')"
    @drop="emit('group-drop', group.groupId, $event)"
  >
    <!-- Divider line -->
    <div class="group-divider"></div>
    
    <!-- Text and icon on top of divider -->
    <div 
      class="group-label"
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
import type { ChannelGroup } from '@argon/glue';
import type { Guid } from '@argon-chat/ion.webcore';

defineProps<{
  group: ChannelGroup & { isCollapsed: boolean };
  isDragOver?: boolean;
}>();

const emit = defineEmits<{
  toggle: [groupId: Guid];
  'group-dragover': [groupId: Guid, event: DragEvent];
  'group-dragleave': [];
  'group-drop': [groupId: Guid, event: DragEvent];
}>();
</script>

<style scoped>
.group-header {
  position: relative;
  padding: 4px 8px;
  cursor: pointer;
}

.group-divider {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background-color: hsl(var(--border));
  transition: background-color 150ms ease;
}

.group-header[data-drag-over] .group-divider {
  height: 2px;
  background-color: hsl(var(--primary));
}

.group-label {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  text-transform: uppercase;
  background-color: hsl(var(--card));
  transition: color 150ms ease;
}

.group-label:hover {
  color: hsl(var(--foreground));
}
</style>
