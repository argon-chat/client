<template>
  <Transition name="channel-switch" mode="out-in">
    <component :is="channelComponent" :key="channelComponentKey" v-bind="{
      selectedSpace,
      selectedChannelId
    }" />
  </Transition>
</template>

<script setup lang="ts">
import { ref, shallowRef, watch, type Component, computed } from "vue";
import { usePoolStore } from "@/store/poolStore";
import TextChannelView from "./TextChannelView.vue";
import MediaChannelView from "./MediaChannelView.vue";
import AnnouncementChannelView from "./AnnouncementChannelView.vue";
import { ArgonChannel, ChannelType } from "@argon/glue";

const pool = usePoolStore();

const selectedSpace = defineModel<string | null>('selectedSpace', { type: String, required: true });
const selectedChannelId = defineModel<string | null>('selectedChannelId', { type: String, required: true });

const channelData = ref<ArgonChannel | null>(null);
const channelComponent = shallowRef<Component>(TextChannelView);
const channelComponentKey = ref(0);

const channelViewMap: Record<ChannelType, Component> = {
  [ChannelType.Text]: TextChannelView,
  [ChannelType.Voice]: MediaChannelView,
  [ChannelType.Announcement]: AnnouncementChannelView,
};

watch(selectedChannelId, async (id) => {
  if (!id) {
    channelData.value = null;
    channelComponent.value = TextChannelView;
    return;
  }
  
  channelData.value = await pool.getChannel(id) ?? null;

  if (!channelData.value) {
    channelComponent.value = TextChannelView;
    return;
  }

  const newComponent = channelViewMap[channelData.value.type] ?? TextChannelView;
  if (channelComponent.value !== newComponent) {
    channelComponent.value = newComponent;
    channelComponentKey.value++;
  }
}, { immediate: true });
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
