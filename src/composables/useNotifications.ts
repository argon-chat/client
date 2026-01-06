import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useApi } from '@/store/apiStore';
import { useBus } from '@/store/busStore';
import { useMe } from '@/store/meStore';
import { DisposableBag } from '@/lib/disposables';
import { logger } from '@/lib/logger';
import type {
    FriendRequestReceivedEvent,
    FriendRequestAcceptedEvent,
    FriendRequestDeclinedEvent,
    FriendRequestCanceledEvent,
} from '@/lib/glue/argonChat';

export function useNotifications() {
    const api = useApi();
    const bus = useBus();
    const me = useMe();
    
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
            const [friendRequests, inventoryNotifications] = await Promise.all([
                api.freindsInteraction.GetMyFriendPendingList(50, 0),
                api.inventoryInteraction.GetNotifications()
            ]);
            
            pendingFriendRequestsCount.value = friendRequests.length;
            newInventoryItemsCount.value = inventoryNotifications.length;
            
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
        // Friend request events
        subs.addSubscription(
            bus.onServerEvent<FriendRequestReceivedEvent>('FriendRequestReceivedEvent', () => {
                pendingFriendRequestsCount.value++;
                logger.info('Friend request received, count:', pendingFriendRequestsCount.value);
            })
        );
        
        subs.addSubscription(
            bus.onServerEvent<FriendRequestAcceptedEvent>('FriendRequestAcceptedEvent', () => {
                if (pendingFriendRequestsCount.value > 0) {
                    pendingFriendRequestsCount.value--;
                    logger.info('Friend request accepted, count:', pendingFriendRequestsCount.value);
                }
            })
        );
        
        subs.addSubscription(
            bus.onServerEvent<FriendRequestDeclinedEvent>('FriendRequestDeclinedEvent', () => {
                if (pendingFriendRequestsCount.value > 0) {
                    pendingFriendRequestsCount.value--;
                    logger.info('Friend request declined, count:', pendingFriendRequestsCount.value);
                }
            })
        );
        
        subs.addSubscription(
            bus.onServerEvent<FriendRequestCanceledEvent>('FriendRequestCanceledEvent', () => {
                if (pendingFriendRequestsCount.value > 0) {
                    pendingFriendRequestsCount.value--;
                    logger.info('Friend request canceled, count:', pendingFriendRequestsCount.value);
                }
            })
        );
    }
    
    function markInventoryItemSeen(instanceId: string) {
        if (newInventoryItemsCount.value > 0) {
            newInventoryItemsCount.value--;
            logger.info('Inventory item marked as seen, count:', newInventoryItemsCount.value);
        }
        
        // Uncomment when ready to send to backend
        // api.inventoryInteraction.MarkSeen([instanceId]).catch(err => {
        //     logger.error('Failed to mark inventory item as seen:', err);
        // });
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
