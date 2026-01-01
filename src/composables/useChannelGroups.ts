import { ref, watch, computed, type Ref } from 'vue';
import { usePoolStore } from '@/store/poolStore';
import type { ChannelGroup } from '@/lib/glue/argonChat';
import type { Guid } from '@argon-chat/ion.webcore';

export function useChannelGroups(selectedSpaceId: Ref<string>) {
  const pool = usePoolStore();
  const channelGroups = ref<ChannelGroup[]>([]);
  const collapsedGroups = ref<Set<Guid>>(new Set());

  const updateGroups = async () => {
    if (!selectedSpaceId.value) {
      channelGroups.value = [];
      return;
    }
    const groups = await pool.db.channelGroups
      .where('spaceId')
      .equals(selectedSpaceId.value)
      .toArray();
    channelGroups.value = groups;
  };

  const sortByFractionalIndex = <T extends { fractionalIndex: string | null }>(items: T[]): T[] => {
    return [...items].sort((a, b) => {
      if (a.fractionalIndex === null && b.fractionalIndex === null) return 0;
      if (a.fractionalIndex === null) return 1;
      if (b.fractionalIndex === null) return -1;
      return a.fractionalIndex.localeCompare(b.fractionalIndex);
    });
  };

  const sortedGroups = computed(() => {
    const groups = channelGroups.value;
    const sorted = sortByFractionalIndex(groups);
    return sorted.map(group => ({
      ...group,
      isCollapsed: group.isCollapsed || collapsedGroups.value.has(group.groupId)
    }));
  });

  const toggleGroup = (groupId: Guid) => {
    if (collapsedGroups.value.has(groupId)) {
      collapsedGroups.value.delete(groupId);
    } else {
      collapsedGroups.value.add(groupId);
    }
  };

  watch(selectedSpaceId, updateGroups, { immediate: true });

  return {
    channelGroups,
    collapsedGroups,
    sortedGroups,
    toggleGroup,
    updateGroups,
    sortByFractionalIndex
  };
}
