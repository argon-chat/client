<template>
  <Transition name="channel-switch" mode="out-in">
    <component :is="channelComponent" :key="channelComponentKey" v-bind="channelProps" />
  </Transition>
</template>

<script setup lang="ts">
import { ref, shallowRef, watch, type Component, computed, onUnmounted } from "vue";
import { liveQuery, type Subscription } from "dexie";
import { usePoolStore } from "@/store/data/poolStore";
import { db } from "@/store/db/dexie";
import TextChannelView from "./TextChannelView.vue";
import MediaChannelView from "./MediaChannelView.vue";
import { ArgonChannel, ChannelType } from "@argon/glue";

const pool = usePoolStore();

const selectedSpace = defineModel<string | null>('selectedSpace', { type: String, required: true });
const selectedChannelId = defineModel<string | null>('selectedChannelId', { type: String, required: true });

const channelData = ref<ArgonChannel | null>(null);
const channelComponent = shallowRef<Component>(TextChannelView);
const channelComponentKey = ref(0);
const channelType = ref<'text' | 'announcement'>('text');

const channelViewMap: Record<ChannelType, Component> = {
  [ChannelType.Text]: TextChannelView,
  [ChannelType.Voice]: MediaChannelView,
  [ChannelType.Announcement]: TextChannelView,
};

const channelProps = computed(() => ({
  selectedSpace: selectedSpace.value,
  selectedChannelId: selectedChannelId.value,
  ...(channelComponent.value === TextChannelView ? { channelType: channelType.value } : {}),
}));

watch(selectedChannelId, async (id) => {
  if (!id) {
    channelData.value = null;
    channelComponent.value = TextChannelView;
    channelType.value = 'text';
    return;
  }
  
  channelData.value = await pool.getChannel(id) ?? null;

  if (!channelData.value) {
    channelComponent.value = TextChannelView;
    channelType.value = 'text';
    return;
  }

  applyType(channelData.value);
}, { immediate: true });

function applyType(channel: ArgonChannel) {
  channelType.value = channel.type === ChannelType.Announcement ? 'announcement' : 'text';
  const newComponent = channelViewMap[channel.type] ?? TextChannelView;
  if (channelComponent.value !== newComponent) {
    channelComponent.value = newComponent;
    channelComponentKey.value++;
  }
}

// Text and announcement channels convert into each other: follow the stored row so the open view does too.
let typeSub: Subscription | null = null;

watch(selectedChannelId, (id) => {
  typeSub?.unsubscribe();
  typeSub = null;
  if (!id) return;
  typeSub = liveQuery(() => db.channels.get(id)).subscribe({
    next: (channel) => {
      if (!channel || channel.channelId !== selectedChannelId.value || channel.type === channelData.value?.type) return;
      channelData.value = channel;
      applyType(channel);
    },
  });
}, { immediate: true });

onUnmounted(() => typeSub?.unsubscribe());
</script>

<style scoped>
.channel-switch-enter-active {
  transition: opacity 0.15s ease, transform 0.2s ease;
}
.channel-switch-leave-active {
  transition: opacity 0.1s ease;
}
.channel-switch-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.channel-switch-leave-to {
  opacity: 0;
}
</style>
