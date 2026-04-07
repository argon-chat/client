import { ref, watch, computed, type Ref } from 'vue';
import { usePoolStore } from '@/store/data/poolStore';
import type { ChannelGroup } from '@argon/glue';
import type { Guid } from '@argon-chat/ion.webcore';

export function useChannelGroups(selectedSpaceId: Ref<string>) {
  const pool = usePoolStore();
  const channelGroups = ref<ChannelGroup[]>([]);
  // Stores local overrides: true = collapsed, false = expanded
  // If a groupId is NOT in this map, we use the server's isCollapsed value
  const localCollapseOverrides = ref<Map<Guid, boolean>>(new Map());

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
    return sorted.map(group => {
      const localOverride = localCollapseOverrides.value.get(group.groupId);
      return {
        ...group,
        isCollapsed: localOverride !== undefined ? localOverride : !!group.isCollapsed
      };
    });
  });

  const toggleGroup = (groupId: Guid) => {
    const currentGroup = sortedGroups.value.find(g => g.groupId === groupId);
    if (!currentGroup) return;
    // Toggle: set the local override to the opposite of the current resolved state
    localCollapseOverrides.value.set(groupId, !currentGroup.isCollapsed);
  };

  // Reset local overrides when switching spaces
  watch(selectedSpaceId, () => {
    localCollapseOverrides.value.clear();
    updateGroups();
  }, { immediate: true });

  return {
    channelGroups,
    sortedGroups,
    toggleGroup,
    updateGroups,
    sortByFractionalIndex
  };
}
