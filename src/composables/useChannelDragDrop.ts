import { ref, type Ref } from 'vue';
import { usePexStore } from '@/store/permissionStore';
import { useApi } from '@/store/apiStore';
import { logger } from '@argon/core';
import type { Guid } from '@argon-chat/ion.webcore';

export function useChannelDragDrop(
  selectedSpaceId: Ref<string>,
  sortedUngroupedChannels: Ref<any[]>,
  getGroupChannels: (groupId: Guid) => any[]
) {
  const pex = usePexStore();
  const api = useApi();

  const draggedChannel = ref<{ channelId: Guid; groupId: Guid | null } | null>(null);
  const dragOverChannel = ref<Guid | null>(null);

  const onDragStart = (channel: any, groupId: Guid | null, event: DragEvent) => {
    if (!pex.has('ManageChannels')) {
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
    if (!draggedChannel.value || !pex.has('ManageChannels')) return;
    dragOverChannel.value = channel.channelId;
  };

  const onDrop = async (targetChannel: any, targetGroupId: Guid | null, index: number, event: DragEvent) => {
    event.preventDefault();
    dragOverChannel.value = null;

    if (!draggedChannel.value || !pex.has('ManageChannels')) return;
    if (!selectedSpaceId.value) return;

    const sourceChannelId = draggedChannel.value.channelId;

    // Don't move if dropping on itself
    if (sourceChannelId === targetChannel.channelId) return;

    try {
      // Get the list of channels in the target group/ungrouped
      const targetChannels = targetGroupId === null
        ? sortedUngroupedChannels.value
        : getGroupChannels(targetGroupId);

      const targetIndex = targetChannels.findIndex(c => c.channelId === targetChannel.channelId);

      // Determine afterChannelId and beforeChannelId
      let afterChannelId: Guid | null = null;
      let beforeChannelId: Guid | null = null;

      // Insert before target
      if (targetIndex > 0) {
        afterChannelId = targetChannels[targetIndex - 1].channelId;
      }
      beforeChannelId = targetChannel.channelId;

      logger.info('Moving channel', {
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

      // Event will update the database automatically
    } catch (error) {
      logger.error('Failed to move channel', error);
    } finally {
      draggedChannel.value = null;
    }
  };

  const onDragEnd = () => {
    draggedChannel.value = null;
    dragOverChannel.value = null;
  };

  return {
    draggedChannel,
    dragOverChannel,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd
  };
}
