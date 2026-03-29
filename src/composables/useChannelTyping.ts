import { onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import { usePoolStore } from "@/store/poolStore";
import { useBus } from "@/store/busStore";
import type { RealtimeUser } from "@/store/db/dexie";
import type { Subscription } from "rxjs";
import { ArgonChannel, UserStopTypingEvent, UserTypingEvent } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { logger } from "@argon/core";

const TYPING_TIMEOUT_MS = 15000;

export function useChannelTyping(
  selectedChannelId: Ref<string | null>,
  channelData: Ref<ArgonChannel | null>,
) {
  const pool = usePoolStore();
  const bus = useBus();

  const typingUsers = ref<RealtimeUser[]>([]);
  const lastTypingTime = new Map<string, number>();
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let sub: Subscription | null = null;

  function scheduleTypingTimeout(userId: string) {
    const oldTimer = typingTimers.get(userId);
    if (oldTimer) clearTimeout(oldTimer);

    const timer = setTimeout(() => {
      const last = lastTypingTime.get(userId);
      if (last && Date.now() - last >= TYPING_TIMEOUT_MS) {
        typingUsers.value = typingUsers.value.filter((u) => u.userId !== userId);
        typingTimers.delete(userId);
        lastTypingTime.delete(userId);
      }
    }, TYPING_TIMEOUT_MS + 100);

    typingTimers.set(userId, timer);
  }

  const onTyping = () => {
    if (!channelData.value) return;
    bus.IAmTypingEvent(channelData.value.channelId);
  };

  const onStopTyping = () => {
    if (!channelData.value) return;
    bus.IAmStopTypingEvent(channelData.value.channelId);
  };

  watch(selectedChannelId, () => {
    typingUsers.value = [];
  });

  onMounted(() => {
    sub = bus.onServerEvent<UserTypingEvent>("UserTypingEvent", async (q) => {
      if (q.channelId !== selectedChannelId.value) return;

      lastTypingTime.set(q.userId, Date.now());

      if (!typingUsers.value.some((u) => u.userId === q.userId)) {
        const user = await pool.getUser(q.userId);
        if (user) {
          typingUsers.value = [...typingUsers.value, user];
        }
      }

      scheduleTypingTimeout(q.userId);
    });

    sub.add(
      bus.onServerEvent<UserStopTypingEvent>("UserStopTypingEvent", (q) => {
        if (q.channelId !== selectedChannelId.value) return;

        typingUsers.value = typingUsers.value.filter((u) => u.userId !== q.userId);
        lastTypingTime.delete(q.userId);

        const timer = typingTimers.get(q.userId);
        if (timer) {
          clearTimeout(timer);
          typingTimers.delete(q.userId);
        }
      }),
    );
  });

  onUnmounted(() => {
    sub?.unsubscribe();
    typingTimers.forEach((timer) => clearTimeout(timer));
    typingTimers.clear();
    lastTypingTime.clear();
  });

  return {
    typingUsers,
    onTyping,
    onStopTyping,
  };
}
