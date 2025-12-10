import { DisposableBag } from "@/lib/disposables";
import { FriendRequestAcceptedEvent, FriendRequestCanceledEvent, FriendRequestDeclinedEvent, FriendRequestReceivedEvent, FriendRequestSentEvent, FriendshipRemovedEvent, UserBlockedEvent, UserUnblockedEvent } from "@/lib/glue/argonChat";
import { useBus } from "@/store/busStore";
import { onUnmounted } from "vue";

export const FriendEventNames = {
    RequestReceived: "FriendRequestReceivedEvent",
    RequestSent: "FriendRequestSentEvent",
    RequestAccepted: "FriendRequestAcceptedEvent",
    RequestDeclined: "FriendRequestDeclinedEvent",
    RequestCanceled: "FriendRequestCanceledEvent",
    FriendshipRemoved: "FriendshipRemovedEvent",
    UserBlocked: "UserBlockedEvent",
    UserUnblocked: "UserUnblockedEvent",
} as const;

export type FriendEventName = typeof FriendEventNames[keyof typeof FriendEventNames];

export function useFriendEvents(handlers: {
    onRequestReceived?: (e: FriendRequestReceivedEvent) => void;
    onRequestSent?: (e: FriendRequestSentEvent) => void;
    onRequestAccepted?: (e: FriendRequestAcceptedEvent) => void;
    onRequestDeclined?: (e: FriendRequestDeclinedEvent) => void;
    onRequestCanceled?: (e: FriendRequestCanceledEvent) => void;
    onFriendshipRemoved?: (e: FriendshipRemovedEvent) => void;
    onUserBlocked?: (e: UserBlockedEvent) => void;
    onUserUnblocked?: (e: UserUnblockedEvent) => void;
}) {

    const bus = useBus();

    const subs = new DisposableBag();

    if (handlers.onRequestReceived) {
        subs.addSubscription(
            bus.onServerEvent<FriendRequestReceivedEvent>(
                FriendEventNames.RequestReceived,
                handlers.onRequestReceived
            )
        );
    }

    if (handlers.onRequestSent) {
        subs.addSubscription(
            bus.onServerEvent<FriendRequestSentEvent>(
                FriendEventNames.RequestSent,
                handlers.onRequestSent
            )
        );
    }

    if (handlers.onRequestAccepted) {
        subs.addSubscription(
            bus.onServerEvent<FriendRequestAcceptedEvent>(
                FriendEventNames.RequestAccepted,
                handlers.onRequestAccepted
            )
        );
    }

    if (handlers.onRequestDeclined) {
        subs.addSubscription(
            bus.onServerEvent<FriendRequestDeclinedEvent>(
                FriendEventNames.RequestDeclined,
                handlers.onRequestDeclined
            )
        );
    }

    if (handlers.onRequestCanceled) {
        subs.addSubscription(
            bus.onServerEvent<FriendRequestCanceledEvent>(
                FriendEventNames.RequestCanceled,
                handlers.onRequestCanceled
            )
        );
    }

    if (handlers.onFriendshipRemoved) {
        subs.addSubscription(
            bus.onServerEvent<FriendshipRemovedEvent>(
                FriendEventNames.FriendshipRemoved,
                handlers.onFriendshipRemoved
            )
        );
    }

    if (handlers.onUserBlocked) {
        subs.addSubscription(
            bus.onServerEvent<UserBlockedEvent>(
                FriendEventNames.UserBlocked,
                handlers.onUserBlocked
            )
        );
    }

    if (handlers.onUserUnblocked) {
        subs.addSubscription(
            bus.onServerEvent<UserUnblockedEvent>(
                FriendEventNames.UserUnblocked,
                handlers.onUserUnblocked
            )
        );
    }


    onUnmounted(() => {
        subs.dispose();
    });
}
