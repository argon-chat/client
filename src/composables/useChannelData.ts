import { onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import { usePoolStore } from "@/store/poolStore";
import type { Subscription } from "rxjs";
import { type ArgonChannel } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

export function useChannelData(selectedChannelId: Ref<string | null>) {
  const pool = usePoolStore();

  const channelData = ref<ArgonChannel | null>(null);
  let sub: Subscription | null = null;

  const getChannel = (channelId: Guid) => pool.getChannel(channelId);

  watch(
    selectedChannelId,
    async (newChannelId) => {
      if (newChannelId) {
        const channel = await getChannel(newChannelId);
        channelData.value = channel ?? null;
      } else {
        channelData.value = null;
      }
    },
    { immediate: true },
  );

  const onChannelChanged = async (channelId: Guid | null) => {
    selectedChannelId.value = channelId;
    if (channelId) {
      const channel = await getChannel(channelId);
      if (channel) channelData.value = channel;
    }
  };

  onMounted(() => {
    sub = pool.onChannelChanged.subscribe(onChannelChanged);
  });

  onUnmounted(() => {
    sub?.unsubscribe();
  });

  return {
    channelData,
  };
}
