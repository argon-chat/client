/**
 * Emits transient toasts to the in-game overlay (notifications widget) for
 * overlay-relevant events: someone joining your voice channel, an @mention, a
 * recording starting, an incoming DM, and friend requests. No-op outside Electron
 * / in the overlay window / when the overlay feature flag is off.
 *
 * Note: a spam-free "friend came online" toast needs a friends×presence join that
 * the client doesn't expose today — friend-request events stand in for the social
 * signal until that lands.
 */
import { usePoolStore } from "@/store/data/poolStore";
import { useBus } from "@/store/realtime/busStore";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useMe } from "@/store/auth/meStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import type { OverlayNotification, OverlayNotificationKind } from "@/lib/overlay";

let counter = 0;
const nextId = () => `n${++counter}`;

export function useOverlayNotificationsPublisher(): void {
  const bridge = (globalThis as any).argonOverlay;
  if (!bridge?.publishOverlayNotification || bridge?.isOverlayWindow) return;

  const pool = usePoolStore();
  const bus = useBus();
  const voice = useUnifiedCall();
  const me = useMe();
  const featureFlags = useFeatureFlags();

  const emit = (kind: OverlayNotificationKind, title: string, body?: string) => {
    if (!featureFlags.overlayGamesEnabled) return;
    const n: OverlayNotification = { id: nextId(), kind, title, body };
    bridge.publishOverlayNotification(n);
  };

  const nameOf = async (userId: string): Promise<string> => {
    try {
      const u = await pool.getUser(userId);
      return u?.displayName ?? "Someone";
    } catch {
      return "Someone";
    }
  };

  // Someone joined the voice channel you're in.
  bus.onServerEvent<any>("JoinedToChannelUser", async (e: any) => {
    if (!e || e.channelId !== voice.connectedVoiceChannelId) return;
    if (e.userId === me.me?.userId) return;
    emit("join", `${await nameOf(e.userId)} joined`, "Voice channel");
  });

  // You were @mentioned (and didn't write it yourself).
  bus.onServerEvent<any>("MessageSent", async (e: any) => {
    const msg = e?.message;
    if (!msg || msg.sender === me.me?.userId) return;
    const myId = me.me?.userId;
    const mentioned = (msg.entities ?? []).some((en: any) => en?.userId === myId);
    if (!mentioned) return;
    emit("mention", `${await nameOf(msg.sender)} mentioned you`, (msg.text ?? "").slice(0, 80));
  });

  // Recording started in your voice channel.
  bus.onServerEvent<any>("RecordStarted", async (e: any) => {
    if (!e || e.channelId !== voice.connectedVoiceChannelId) return;
    emit("record", "Recording started", e.byUserId ? `by ${await nameOf(e.byUserId)}` : undefined);
  });

  // Incoming direct message.
  bus.onServerEvent<any>("DirectMessageSent", async (e: any) => {
    if (!e || (e.receiverId && e.receiverId !== me.me?.userId)) return;
    const from = e.senderId ?? e.sender;
    if (!from || from === me.me?.userId) return;
    emit("dm", `Message from ${await nameOf(from)}`, (e.text ?? e.message?.text ?? "").slice(0, 80));
  });

  // Friend requests (stand-in for the social/online signal).
  bus.onServerEvent<any>("FriendRequestReceivedEvent", async (e: any) => {
    const from = e?.fromUserId ?? e?.senderId ?? e?.userId;
    emit("info", "Friend request", from ? `from ${await nameOf(from)}` : undefined);
  });
  bus.onServerEvent<any>("FriendRequestAcceptedEvent", async (e: any) => {
    const who = e?.byUserId ?? e?.userId ?? e?.toUserId;
    emit("online", who ? `${await nameOf(who)} is now your friend` : "Friend request accepted");
  });
}
