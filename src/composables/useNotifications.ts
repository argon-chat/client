import { ref, computed } from 'vue';
import { useApi } from '@/store/apiStore';
import { useBus } from '@/store/busStore';
import { DisposableBag } from '@/lib/disposables';
import { logger } from '@/lib/logger';
import type { UpdatedNotificationCounters } from '@/lib/glue/argonChat';

export function useNotifications() {
    const api = useApi();
    const bus = useBus();
    
    const pendingFriendRequestsCount = ref(0);
    const newInventoryItemsCount = ref(0);
    const loading = ref(true);
    
    const totalNotifications = computed(() => 
        pendingFriendRequestsCount.value + newInventoryItemsCount.value
    );
    
    const subs = new DisposableBag();
    
    async function loadNotifications() {
        loading.value = true;
        try {
            const counters = await api.userInteraction.GetNotificationCounters();
            
            for (const counter of counters) {
                if (counter.counterType === 'pending_friend_requests') {
                    pendingFriendRequestsCount.value = Number(counter.count);
                } else if (counter.counterType === 'unread_inventory') {
                    newInventoryItemsCount.value = Number(counter.count);
                }
            }
            
            logger.info('Loaded notifications:', {
                friends: pendingFriendRequestsCount.value,
                inventory: newInventoryItemsCount.value
            });
        } catch (error) {
            logger.error('Failed to load notifications:', error);
        } finally {
            loading.value = false;
        }
    }
    
    function subscribeToEvents() {
        subs.addSubscription(
            bus.onServerEvent<UpdatedNotificationCounters>('UpdatedNotificationCounters', (event) => {
                for (const counter of event.counters) {
                    if (counter.counterType === 'pending_friend_requests') {
                        pendingFriendRequestsCount.value = Number(counter.count);
                        logger.info('Friend requests count updated:', counter.count);
                    } else if (counter.counterType === 'unread_inventory') {
                        newInventoryItemsCount.value = Number(counter.count);
                        logger.info('Inventory items count updated:', counter.count);
                    }
                }
            })
        );
    }
    
    async function markInventoryItemSeen(instanceId: string) {
        if (newInventoryItemsCount.value > 0) {
            newInventoryItemsCount.value--;
            logger.info('Inventory item marked as seen, count:', newInventoryItemsCount.value);
        }
        await api.inventoryInteraction.MarkSeen([instanceId]);
    }
    
    function initialize() {
        loadNotifications();
        subscribeToEvents();
    }
    
    function cleanup() {
        subs.dispose();
    }
    
    return {
        pendingFriendRequestsCount,
        newInventoryItemsCount,
        totalNotifications,
        loading,
        initialize,
        cleanup,
        loadNotifications,
        markInventoryItemSeen,
    };
}
