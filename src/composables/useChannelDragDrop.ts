import { ref, computed, type Ref } from 'vue';
import { usePexStore } from '@/store/data/permissionStore';
import { useApi } from '@/store/system/apiStore';
import { logger } from '@argon/core';
import type { Guid } from '@argon-chat/ion.webcore';

export type DropPosition = 'before' | 'after';

type Dragged =
  | { kind: 'channel'; channelId: Guid; groupId: Guid | null }
  | { kind: 'group'; groupId: Guid };

export function useChannelDragDrop(
  selectedSpaceId: Ref<string>,
  sortedUngroupedChannels: Ref<any[]>,
  getGroupChannels: (groupId: Guid) => any[],
  sortedGroups: Ref<{ groupId: Guid }[]>,
) {
  const pex = usePexStore();
  const api = useApi();

  const dragged = ref<Dragged | null>(null);

  // Channel-level drop state
  const dragOverChannel = ref<Guid | null>(null);
  const dropPosition = ref<DropPosition>('before');
  // Channel-into-group highlight
  const dragOverGroupId = ref<Guid | null>(null);
  // Group reorder state
  const dragOverGroupReorder = ref<Guid | null>(null);
  const groupDropPosition = ref<DropPosition>('before');

  const canDrag = () => pex.has('ManageChannels');

  // Kept for ChatList template (tail drop zones only show while dragging a channel).
  const draggedChannel = computed(() =>
    dragged.value?.kind === 'channel' ? dragged.value : null,
  );

  const setMoveEffect = (event: DragEvent) => {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  };

  const resetOver = () => {
    dragOverChannel.value = null;
    dragOverGroupId.value = null;
    dragOverGroupReorder.value = null;
  };

  // ── Channel drag ───────────────────────────────────────────────────

  const onDragStart = (channel: any, groupId: Guid | null, event: DragEvent) => {
    if (!canDrag()) {
      event.preventDefault();
      return;
    }
    dragged.value = { kind: 'channel', channelId: channel.channelId, groupId };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', channel.channelId);
    }
  };

  const onDragOver = (channel: any, groupId: Guid | null, _index: number, event: DragEvent) => {
    if (dragged.value?.kind !== 'channel') return; // groups don't drop onto channels
    event.preventDefault();
    setMoveEffect(event);

    dragOverChannel.value = channel.channelId;
    dragOverGroupId.value = groupId;
    dragOverGroupReorder.value = null;

    const target = (event.target as HTMLElement)?.closest?.('.channel-item') as HTMLElement | null;
    if (target) {
      const rect = target.getBoundingClientRect();
      dropPosition.value = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    }
  };

  const onDrop = async (targetChannel: any, targetGroupId: Guid | null, _index: number, event: DragEvent) => {
    event.preventDefault();
    const pos = dropPosition.value;
    resetOver();

    if (dragged.value?.kind !== 'channel' || !selectedSpaceId.value) return;
    const sourceChannelId = dragged.value.channelId;

    if (sourceChannelId === targetChannel.channelId && dragged.value.groupId === targetGroupId) {
      return;
    }

    try {
      const rawChannels = targetGroupId === null
        ? sortedUngroupedChannels.value
        : getGroupChannels(targetGroupId);
      const targetChannels = rawChannels.filter(c => c.channelId !== sourceChannelId);
      const targetIndex = targetChannels.findIndex(c => c.channelId === targetChannel.channelId);

      let afterChannelId: Guid | null = null;
      let beforeChannelId: Guid | null = null;

      if (targetIndex === -1) {
        if (targetChannels.length > 0) afterChannelId = targetChannels[targetChannels.length - 1].channelId;
      } else if (pos === 'before') {
        if (targetIndex > 0) afterChannelId = targetChannels[targetIndex - 1].channelId;
        beforeChannelId = targetChannel.channelId;
      } else {
        afterChannelId = targetChannel.channelId;
        if (targetIndex < targetChannels.length - 1) beforeChannelId = targetChannels[targetIndex + 1].channelId;
      }

      await api.channelInteraction.MoveChannel(
        selectedSpaceId.value, sourceChannelId, targetGroupId, afterChannelId, beforeChannelId,
      );
    } catch (error) {
      logger.error('Failed to move channel', error);
    } finally {
      dragged.value = null;
    }
  };

  // Drop a channel at the end of a group/ungrouped list.
  const onTailDrop = async (targetGroupId: Guid | null, event: DragEvent) => {
    event.preventDefault();
    resetOver();

    if (dragged.value?.kind !== 'channel' || !selectedSpaceId.value) return;
    const sourceChannelId = dragged.value.channelId;

    try {
      const channels = (targetGroupId === null
        ? sortedUngroupedChannels.value
        : getGroupChannels(targetGroupId)
      ).filter(c => c.channelId !== sourceChannelId);

      const afterChannelId = channels.length > 0 ? channels[channels.length - 1].channelId : null;

      await api.channelInteraction.MoveChannel(
        selectedSpaceId.value, sourceChannelId, targetGroupId, afterChannelId, null,
      );
    } catch (error) {
      logger.error('Failed to move channel to end', error);
    } finally {
      dragged.value = null;
    }
  };

  // ── Group drag (reorder) ───────────────────────────────────────────

  const onGroupDragStart = (groupId: Guid, event: DragEvent) => {
    if (!canDrag()) {
      event.preventDefault();
      return;
    }
    dragged.value = { kind: 'group', groupId };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', groupId);
    }
  };

  // Unified group-header dragover/drop — routes by what's being dragged.
  const onHeaderDragOver = (groupId: Guid, event: DragEvent) => {
    if (!dragged.value) return;
    event.preventDefault();
    setMoveEffect(event);

    if (dragged.value.kind === 'group') {
      dragOverGroupId.value = null;
      if (dragged.value.groupId === groupId) {
        dragOverGroupReorder.value = null;
        return;
      }
      const el = event.currentTarget as HTMLElement | null;
      if (el) {
        const rect = el.getBoundingClientRect();
        groupDropPosition.value = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      }
      dragOverGroupReorder.value = groupId;
    } else {
      // dragging a channel onto the group header → drop into this group
      dragOverGroupReorder.value = null;
      dragOverGroupId.value = groupId;
    }
  };

  const onHeaderDragLeave = () => {
    dragOverGroupId.value = null;
    dragOverGroupReorder.value = null;
  };

  const onHeaderDrop = async (groupId: Guid, event: DragEvent) => {
    event.preventDefault();
    const pos = groupDropPosition.value;
    const current = dragged.value;
    resetOver();

    if (!current || !selectedSpaceId.value) return;

    if (current.kind === 'channel') {
      // Channel dropped onto group header → append into group.
      const sourceChannelId = current.channelId;
      try {
        const groupChannels = getGroupChannels(groupId).filter(c => c.channelId !== sourceChannelId);
        const afterChannelId = groupChannels.length > 0 ? groupChannels[groupChannels.length - 1].channelId : null;
        await api.channelInteraction.MoveChannel(selectedSpaceId.value, sourceChannelId, groupId, afterChannelId, null);
      } catch (error) {
        logger.error('Failed to move channel to group', error);
      } finally {
        dragged.value = null;
      }
      return;
    }

    // Group reorder.
    const movedId = current.groupId;
    if (movedId === groupId) {
      dragged.value = null;
      return;
    }
    try {
      const groups = sortedGroups.value.filter(g => g.groupId !== movedId);
      const targetIndex = groups.findIndex(g => g.groupId === groupId);

      let afterGroupId: Guid | null = null;
      let beforeGroupId: Guid | null = null;

      if (targetIndex !== -1) {
        if (pos === 'before') {
          if (targetIndex > 0) afterGroupId = groups[targetIndex - 1].groupId;
          beforeGroupId = groupId;
        } else {
          afterGroupId = groupId;
          if (targetIndex < groups.length - 1) beforeGroupId = groups[targetIndex + 1].groupId;
        }
      }

      // Service is (spaceId, channelId) — for group ops the moved group id is the context id.
      await api.channelInteraction.MoveChannelGroup(
        selectedSpaceId.value, movedId, afterGroupId, beforeGroupId,
      );
    } catch (error) {
      logger.error('Failed to reorder group', error);
    } finally {
      dragged.value = null;
    }
  };

  const onDragEnd = () => {
    dragged.value = null;
    resetOver();
  };

  return {
    canDrag,
    draggedChannel,
    dragOverChannel,
    dropPosition,
    dragOverGroupId,
    dragOverGroupReorder,
    groupDropPosition,
    onDragStart,
    onDragOver,
    onDrop,
    onTailDrop,
    onGroupDragStart,
    onHeaderDragOver,
    onHeaderDragLeave,
    onHeaderDrop,
    onDragEnd,
  };
}
