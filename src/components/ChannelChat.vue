<template>
  <component :is="channelComponent" v-bind="{
    selectedSpace,
    selectedChannelId
  }" />
</template>

<script setup lang="ts">
import { ref, shallowRef, watch, type Component } from "vue";
import { usePoolStore } from "@/store/poolStore";
import TextChannelView from "./TextChannelView.vue";
import MediaChannelView from "./MediaChannelView.vue";
import AnnouncementChannelView from "./AnnouncementChannelView.vue";
import { ArgonChannel, ChannelType } from "@/lib/glue/argonChat";
import { logger } from "@/lib/logger";

const pool = usePoolStore();

const selectedSpace = defineModel<string | null>('selectedSpace', { type: String, required: true });
const selectedChannelId = defineModel<string | null>('selectedChannelId', { type: String, required: true });

const channelData = ref<ArgonChannel | null>(null);
const channelComponent = shallowRef<Component>(TextChannelView);

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

  channelComponent.value = channelViewMap[channelData.value.type] ?? TextChannelView;
}, { immediate: true });
</script>
