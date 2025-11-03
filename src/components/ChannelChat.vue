<template>
  <component :is="channelComponent" v-bind="{
    selectedSpace,
    selectedChannelId
  }" />
</template>

<script setup lang="ts">
import { ref, shallowRef, watch } from "vue";
import { usePoolStore } from "@/store/poolStore";
import TextChannelView from "./TextChannelView.vue";
import MediaChannelView from "./MediaChannelView.vue";
import { ArgonChannel, ChannelType } from "@/lib/glue/argonChat";
import { logger } from "@/lib/logger";

const pool = usePoolStore();

const selectedSpace = defineModel<string | null>('selectedSpace', { type: String, required: true });
const selectedChannelId = defineModel<string | null>('selectedChannelId', { type: String, required: true });

const channelData = ref<ArgonChannel | null>(null);

watch(selectedChannelId, async (id) => {

  logger.warn("watch(selectedChannelId", id)
  if (!id) {
    channelData.value = null;
    return;
  }
  channelData.value = await pool.getChannel(id) ?? null;

  if (!channelData.value)
    return;

  if (channelData.value.type == ChannelType.Voice)
    channelComponent.value = MediaChannelView;
});



const channelComponent = shallowRef(TextChannelView);
</script>
