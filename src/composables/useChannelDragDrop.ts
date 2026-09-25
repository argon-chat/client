import { ref, computed, type Ref } from 'vue';
import { usePexStore } from '@/store/data/permissionStore';
import { useApi } from '@/store/system/apiStore';
import { useVoiceModeration } from '@/composables/useVoiceModeration';
import { isVoiceLikeChannel } from '@/lib/voice/channels';
import { logger } from '@argon/core';
import type { Guid } from '@argon-chat/ion.webcore';
import type { ChannelType } from '@argon/glue';

export type DropPosition = 'before' | 'after';

/** A channel row while a voice member is dragged: it takes the drop, or it is also under the cursor. */
export type VoiceDropState = 'candidate' | 'over' | undefined;

type Dragged =
  | { kind: 'channel'; channelId: Guid; groupId: Guid | null }
  | { kind: 'group'; groupId: Guid }
  // A voice member, dragged from the channel they are in to another voice channel.
  | { kind: 'user'; spaceId: Guid; channelId: Guid; userId: Guid };

type DropChannel = { channelId: Guid; spaceId: Guid; type: ChannelType };

export function useChannelDragDrop(
  selectedSpaceId: Ref<string>,
  sortedUngroupedChannels: Ref<any[]>,
  getGroupChannels: (groupId: Guid) => any[],
  sortedGroups: Ref<{ groupId: Guid }[]>,
) {
  const pex = usePexStore();
  const api = useApi();
  const moderation = useVoiceModeration();

  const dragged = ref<Dragged | null>(null);

  // Voice channel under a dragged member, when it would take the drop.
  const voiceDropTarget = ref<Guid | null>(null);

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
    voiceDropTarget.value = null;
  };

  // ── Voice member drag (move to another voice channel) ─────────────

  // The server wants MoveMember on the target as well as on the channel the member leaves.
  const isMemberDropTarget = (channel: DropChannel) => {
    const d = dragged.value;
    return d?.kind === 'user'
      && isVoiceLikeChannel(channel.type)
      && channel.spaceId === d.spaceId
      && channel.channelId !== d.channelId
      && pex.hasIn(channel.channelId, 'MoveMember', channel.spaceId);
  };

  const voiceDropStateOf = (channel: DropChannel): VoiceDropState => {
    if (!isMemberDropTarget(channel)) return undefined;
    return voiceDropTarget.value === channel.channelId ? 'over' : 'candidate';
  };

  const onMemberDragStart = (userId: Guid, channel: DropChannel, event: DragEvent) => {
    if (!pex.hasIn(channel.channelId, 'MoveMember', channel.spaceId)) {
      event.preventDefault();
      return;
    }
    dragged.value = { kind: 'user', spaceId: channel.spaceId, channelId: channel.channelId, userId };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', userId);
    }
  };

  const onMemberDragOver = (channel: DropChannel, event: DragEvent) => {
    if (!isMemberDropTarget(channel)) {
      if (voiceDropTarget.value === channel.channelId) voiceDropTarget.value = null;
      return;
    }
    event.preventDefault();
    setMoveEffect(event);
    voiceDropTarget.value = channel.channelId;
  };

  const onMemberDrop = async (channel: DropChannel, event: DragEvent) => {
    const d = dragged.value;
    const valid = isMemberDropTarget(channel);
    dragged.value = null;
    resetOver();
    if (!valid || d?.kind !== 'user') return;
    event.preventDefault();
    await moderation.moveMember(d.spaceId, d.channelId, d.userId, channel.channelId);
  };

  const onDragLeave = (channel: DropChannel, event: DragEvent) => {
    // Leaving for one of the row's own children is not leaving the row.
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as HTMLElement | null)?.contains?.(next)) return;
    if (voiceDropTarget.value === channel.channelId) voiceDropTarget.value = null;
  };

  // ── Channel drag ───────────────────────────────────────────────────

  // Moving a channel is checked on that channel; groups are space-level.
  const onDragStart = (channel: any, groupId: Guid | null, event: DragEvent) => {
    if (!pex.hasIn(channel.channelId, 'ManageChannels', channel.spaceId)) {
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
    if (dragged.value?.kind === 'user') {
      onMemberDragOver(channel, event);
      return;
    }
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
    if (dragged.value?.kind === 'user') {
      await onMemberDrop(targetChannel, event);
      return;
    }
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
    if (!dragged.value || dragged.value.kind === 'user') return;
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

    if (!current || current.kind === 'user' || !selectedSpaceId.value) return;

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
    voiceDropTarget,
    voiceDropStateOf,
    onDragStart,
    onMemberDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onTailDrop,
    onGroupDragStart,
    onHeaderDragOver,
    onHeaderDragLeave,
    onHeaderDrop,
    onDragEnd,
  };
}
