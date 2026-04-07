import { ref, type Ref } from 'vue';
import { usePexStore } from '@/store/data/permissionStore';
import { useApi } from '@/store/system/apiStore';
import { logger } from '@argon/core';
import type { Guid } from '@argon-chat/ion.webcore';

export type DropPosition = 'before' | 'after';

export function useChannelDragDrop(
  selectedSpaceId: Ref<string>,
  sortedUngroupedChannels: Ref<any[]>,
  getGroupChannels: (groupId: Guid) => any[]
) {
  const pex = usePexStore();
  const api = useApi();

  const draggedChannel = ref<{ channelId: Guid; groupId: Guid | null } | null>(null);
  const dragOverChannel = ref<Guid | null>(null);
  const dropPosition = ref<DropPosition>('before');
  const dragOverGroupId = ref<Guid | null>(null);

  const canDrag = () => pex.has('ManageChannels');

  const onDragStart = (channel: any, groupId: Guid | null, event: DragEvent) => {
    if (!canDrag()) {
      event.preventDefault();
      return;
    }
    draggedChannel.value = { channelId: channel.channelId, groupId };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', channel.channelId);
    }
  };

  const onDragOver = (channel: any, groupId: Guid | null, index: number, event: DragEvent) => {
    if (!draggedChannel.value || !canDrag()) return;
    event.preventDefault();

    dragOverChannel.value = channel.channelId;
    dragOverGroupId.value = groupId;

    // Calculate drop position based on cursor Y within the channel element
    // Use closest() because event.currentTarget is unreliable through Vue emit chain
    const target = (event.target as HTMLElement)?.closest?.('.channel-item') as HTMLElement | null;
    if (target) {
      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      dropPosition.value = event.clientY < midY ? 'before' : 'after';
    }
  };

  // Drop onto a specific channel — insert before or after based on cursor position
  const onDrop = async (targetChannel: any, targetGroupId: Guid | null, index: number, event: DragEvent) => {
    event.preventDefault();
    const currentDropPosition = dropPosition.value;
    dragOverChannel.value = null;
    dragOverGroupId.value = null;

    if (!draggedChannel.value || !canDrag()) return;
    if (!selectedSpaceId.value) return;

    const sourceChannelId = draggedChannel.value.channelId;

    // Don't move if dropping on itself in the same group
    if (sourceChannelId === targetChannel.channelId && draggedChannel.value.groupId === targetGroupId) {
      return;
    }

    try {
      // Get target list, filtering out the source channel to avoid self-reference
      const rawChannels = targetGroupId === null
        ? sortedUngroupedChannels.value
        : getGroupChannels(targetGroupId);
      const targetChannels = rawChannels.filter(c => c.channelId !== sourceChannelId);

      // If target was the source (cross-group move), treat as "append to group"
      const targetIndex = targetChannels.findIndex(c => c.channelId === targetChannel.channelId);

      let afterChannelId: Guid | null = null;
      let beforeChannelId: Guid | null = null;

      if (targetIndex === -1) {
        // Target was filtered out (cross-group self-drop) or group is empty
        // Append to end of group
        if (targetChannels.length > 0) {
          afterChannelId = targetChannels[targetChannels.length - 1].channelId;
        }
      } else if (currentDropPosition === 'before') {
        // Insert before target: after = channel before target, before = target
        if (targetIndex > 0) {
          afterChannelId = targetChannels[targetIndex - 1].channelId;
        }
        beforeChannelId = targetChannel.channelId;
      } else {
        // Insert after target: after = target, before = channel after target
        afterChannelId = targetChannel.channelId;
        if (targetIndex < targetChannels.length - 1) {
          beforeChannelId = targetChannels[targetIndex + 1].channelId;
        }
      }

      logger.info('Moving channel', {
        sourceChannelId,
        targetGroupId,
        afterChannelId,
        beforeChannelId,
        dropPosition: currentDropPosition
      });

      await api.channelInteraction.MoveChannel(
        selectedSpaceId.value,
        sourceChannelId,
        targetGroupId,
        afterChannelId,
        beforeChannelId
      );
    } catch (error) {
      logger.error('Failed to move channel', error);
    } finally {
      draggedChannel.value = null;
    }
  };

  // Drop onto an empty group header (no channels inside)
  const onGroupDrop = async (targetGroupId: Guid, event: DragEvent) => {
    event.preventDefault();
    dragOverChannel.value = null;
    dragOverGroupId.value = null;

    if (!draggedChannel.value || !canDrag()) return;
    if (!selectedSpaceId.value) return;

    const sourceChannelId = draggedChannel.value.channelId;

    try {
      const groupChannels = getGroupChannels(targetGroupId)
        .filter(c => c.channelId !== sourceChannelId);

      let afterChannelId: Guid | null = null;
      let beforeChannelId: Guid | null = null;

      if (groupChannels.length > 0) {
        // Drop at end of group
        afterChannelId = groupChannels[groupChannels.length - 1].channelId;
      }

      logger.info('Moving channel to group', {
        sourceChannelId,
        targetGroupId,
        afterChannelId,
        beforeChannelId
      });

      await api.channelInteraction.MoveChannel(
        selectedSpaceId.value,
        sourceChannelId,
        targetGroupId,
        afterChannelId,
        beforeChannelId
      );
    } catch (error) {
      logger.error('Failed to move channel to group', error);
    } finally {
      draggedChannel.value = null;
    }
  };

  // Drop onto the tail zone at end of a group/ungrouped list
  const onTailDrop = async (targetGroupId: Guid | null, event: DragEvent) => {
    event.preventDefault();
    dragOverChannel.value = null;
    dragOverGroupId.value = null;

    if (!draggedChannel.value || !canDrag()) return;
    if (!selectedSpaceId.value) return;

    const sourceChannelId = draggedChannel.value.channelId;

    try {
      const channels = (targetGroupId === null
        ? sortedUngroupedChannels.value
        : getGroupChannels(targetGroupId)
      ).filter(c => c.channelId !== sourceChannelId);

      const afterChannelId = channels.length > 0
        ? channels[channels.length - 1].channelId
        : null;

      logger.info('Moving channel to end', {
        sourceChannelId,
        targetGroupId,
        afterChannelId
      });

      await api.channelInteraction.MoveChannel(
        selectedSpaceId.value,
        sourceChannelId,
        targetGroupId,
        afterChannelId,
        null
      );
    } catch (error) {
      logger.error('Failed to move channel to end', error);
    } finally {
      draggedChannel.value = null;
    }
  };

  const onGroupDragOver = (groupId: Guid, event: DragEvent) => {
    if (!draggedChannel.value || !canDrag()) return;
    event.preventDefault();
    dragOverGroupId.value = groupId;
  };

  const onGroupDragLeave = () => {
    dragOverGroupId.value = null;
  };

  const onDragEnd = () => {
    draggedChannel.value = null;
    dragOverChannel.value = null;
    dragOverGroupId.value = null;
  };

  return {
    draggedChannel,
    dragOverChannel,
    dropPosition,
    dragOverGroupId,
    onDragStart,
    onDragOver,
    onDrop,
    onGroupDrop,
    onGroupDragOver,
    onGroupDragLeave,
    onTailDrop,
    onDragEnd
  };
}
