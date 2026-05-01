import { computed } from 'vue';
import { useNotificationStore } from '@/store/data/notificationStore';

/**
 * Legacy composable — proxies to useNotificationStore.
 * Kept for backward compatibility with existing consumers.
 */
export function useNotifications() {
    const store = useNotificationStore();

    const pendingFriendRequestsCount = computed(() => store.notifications.friendRequests);
    const newInventoryItemsCount = computed(() => store.notifications.inventory);
    const totalNotifications = computed(() => store.totalSystemBadge);

    function initialize() {
        // No-op: initialization is now handled by poolStore.init()
    }

    function cleanup() {
        // No-op: store lifecycle is managed by Pinia
    }

    async function markInventoryItemSeen(instanceId: string) {
        const { useApi } = await import('@/store/system/apiStore');
        const api = useApi();
        await api.inventoryInteraction.MarkSeen([instanceId]);
        // Decrement local inventory badge counter
        if (store.notifications.inventory > 0) {
            store.notifications = {
                ...store.notifications,
                inventory: store.notifications.inventory - 1,
            };
        }
    }

    return {
        pendingFriendRequestsCount,
        newInventoryItemsCount,
        totalNotifications,
        loading: computed(() => !store.initialized),
        initialize,
        cleanup,
        loadNotifications: initialize,
        markInventoryItemSeen,
    };
}
