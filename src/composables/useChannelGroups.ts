import { ref, watch, computed, onUnmounted, type Ref } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { usePoolStore } from '@/store/data/poolStore';
import { persistedValue } from '@argon/storage';
import { logger } from '@argon/core';
import type { ChannelGroup } from '@argon/glue';
import type { Guid } from '@argon-chat/ion.webcore';

// Per-group collapse overrides, persisted across sessions/space switches.
// groupId absent → fall back to the server's isCollapsed value.
const collapseOverrides = persistedValue<Record<string, boolean>>('channels.collapse', {});

export function useChannelGroups(selectedSpaceId: Ref<string>) {
  const pool = usePoolStore();
  const channelGroups = ref<ChannelGroup[]>([]);

  // Live subscription — reflects create/modify/remove/reorder events instantly.
  let sub: Subscription | null = null;
  const updateGroups = () => {
    sub?.unsubscribe();
    if (!selectedSpaceId.value) {
      channelGroups.value = [];
      return;
    }
    sub = liveQuery(() =>
      pool.db.channelGroups.where('spaceId').equals(selectedSpaceId.value).toArray()
    ).subscribe({
      next: (groups) => (channelGroups.value = groups),
      error: (err) => logger.error('[ChannelGroups] liveQuery error:', err),
    });
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
      const override = collapseOverrides[group.groupId];
      return {
        ...group,
        isCollapsed: override !== undefined ? override : !!group.isCollapsed
      };
    });
  });

  const toggleGroup = (groupId: Guid) => {
    const currentGroup = sortedGroups.value.find(g => g.groupId === groupId);
    if (!currentGroup) return;
    collapseOverrides[groupId] = !currentGroup.isCollapsed;
  };

  watch(selectedSpaceId, () => {
    updateGroups();
  }, { immediate: true });

  onUnmounted(() => sub?.unsubscribe());

  return {
    channelGroups,
    sortedGroups,
    toggleGroup,
    sortByFractionalIndex
  };
}
