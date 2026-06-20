/**
 * Publishes a rolling buffer of the active text channel's most-recent messages to
 * the in-game overlay (chat-peek widget). Live messages only — fills as messages
 * arrive while you're in-game. No-op outside Electron / in the overlay window /
 * when the overlay feature flag is off.
 */
import { watch } from "vue";
import { usePoolStore } from "@/store/data/poolStore";
import { useChannelStore } from "@/store/data/channelStore";
import { useUserColors } from "@/store/chat/userColors";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";

const MAX = 10;

export function useOverlayChatPublisher(): void {
  const bridge = (globalThis as any).argonOverlay;
  if (!bridge?.publishChatPeek || bridge?.isOverlayWindow) return;

  const pool = usePoolStore();
  const channels = useChannelStore();
  const userColors = useUserColors();
  const featureFlags = useFeatureFlags();

  let buffer: { id: string; author: string; authorColor: string; text: string }[] = [];

  const flush = () => bridge.publishChatPeek(buffer.slice());

  pool.onNewMessageReceived.subscribe(async (msg: any) => {
    if (!featureFlags.overlayGamesEnabled) return;
    if (!msg || msg.channelId !== channels.selectedTextChannel) return;
    const text = (msg.text ?? "").trim();
    if (!text) return; // skip empty/attachment-only for the peek

    let author = "Unknown";
    try {
      const user = await pool.getUser(msg.sender);
      if (user?.displayName) author = user.displayName;
    } catch { /* ignore */ }

    buffer.push({
      id: String(msg.messageId ?? buffer.length),
      author,
      authorColor: userColors.getColorByUserId(msg.sender),
      text,
    });
    if (buffer.length > MAX) buffer = buffer.slice(-MAX);
    flush();
  });

  // Reset the peek when the user switches channels.
  watch(
    () => channels.selectedTextChannel,
    () => { buffer = []; flush(); },
  );
}
