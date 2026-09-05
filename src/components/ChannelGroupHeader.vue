<template>
  <div
    class="group-header"
    :draggable="canDrag"
    :data-channel-drag-over="isChannelDragOver || undefined"
    :data-group-drag-over="isGroupDragOver ? groupDropPosition : undefined"
    :data-draggable="canDrag || undefined"
    @dragstart="emit('dragstart', group.groupId, $event)"
    @dragend="emit('dragend')"
    @dragover.prevent="emit('dragover', group.groupId, $event)"
    @dragleave="emit('dragleave')"
    @drop="emit('drop', group.groupId, $event)"
  >
    <div class="group-label" @click="emit('toggle', group.groupId)">
      <ChevronRightIcon v-if="group.isCollapsed" class="group-chevron icon-appear" />
      <ChevronDownIcon v-else class="group-chevron icon-appear" />
      <span class="group-name" :title="group.name">{{ group.name }}</span>
    </div>

    <!-- The rule runs from the label to the edge, so nothing has to be painted over it. -->
    <div class="group-divider"></div>
  </div>
</template>

<script setup lang="ts">
import { ChevronRightIcon, ChevronDownIcon } from 'lucide-vue-next';
import type { ChannelGroup } from '@argon/glue';
import type { Guid } from '@argon-chat/ion.webcore';
import type { DropPosition } from '@/composables/useChannelDragDrop';

defineProps<{
  group: ChannelGroup & { isCollapsed: boolean };
  canDrag?: boolean;
  /** A channel is being dragged onto this header (drop into group). */
  isChannelDragOver?: boolean;
  /** A group is being dragged over this header (reorder). */
  isGroupDragOver?: boolean;
  groupDropPosition?: DropPosition;
}>();

const emit = defineEmits<{
  toggle: [groupId: Guid];
  dragstart: [groupId: Guid, event: DragEvent];
  dragend: [];
  dragover: [groupId: Guid, event: DragEvent];
  dragleave: [];
  drop: [groupId: Guid, event: DragEvent];
}>();
</script>

<style scoped>
.group-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  cursor: pointer;
}

.group-header[data-draggable] {
  cursor: grab;
}

.group-header[data-draggable]:active {
  cursor: grabbing;
}

/*
 * A sibling of the label rather than a full-width line behind it: the label used to hide the line
 * with a card-coloured background, which matched the sidebar on the dark theme and showed up as a
 * box around the name on the light one.
 */
.group-divider {
  flex: 1 0 8px;
  height: 1px;
  background-color: hsl(var(--border));
  transition: background-color 150ms ease, height 150ms ease;
}

/* Channel-into-group highlight */
.group-header[data-channel-drag-over] .group-divider {
  height: 2px;
  background-color: hsl(var(--primary));
}

/* Group reorder indicator */
.group-header[data-group-drag-over]::before,
.group-header[data-group-drag-over]::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  background: hsl(var(--primary));
  border-radius: 1px;
  pointer-events: none;
}
.group-header[data-group-drag-over='before']::before {
  top: 0;
}
.group-header[data-group-drag-over='after']::after {
  bottom: 0;
}

.group-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  min-width: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: hsl(var(--muted-foreground));
  text-transform: uppercase;
  transition: color 150ms ease;
}

.group-label:hover {
  color: hsl(var(--foreground));
}

.group-chevron {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  transition: transform 150ms ease;
}

/* Names never wrap past one line. */
.group-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
