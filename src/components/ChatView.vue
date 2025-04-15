<template>
    <div ref="scroller" class="chat-scroll messages">
        <div v-for="(message) in messages" :key="message.MessageId" class="chat-message">
            <MessageItem :message="message" />
        </div>
        <Separator v-if="hasEnded" orientation="horizontal"> </Separator>
        <div v-if="hasEnded" style="text-align: center;"> END </div>

    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, useTemplateRef, onUnmounted } from 'vue'
import { useInfiniteScroll } from '@vueuse/core'
import MessageItem from '@/components/MessageItem.vue'
import { useApi } from '@/store/apiStore'
import { logger } from '@/lib/logger';
import { Separator } from '@/components/ui/separator'
import { usePoolStore } from '@/store/poolStore';
import { Subscription } from 'rxjs';
const api = useApi();
const pool = usePoolStore();
const props = defineProps<{
    channelId: Guid
}>()

const scroller = useTemplateRef<HTMLElement>("scroller");

const messages = ref([] as IArgonMessageDto[]);

const hasEnded = ref(false);

const subs = ref(null as null | Subscription);

useInfiniteScroll(scroller, async () => {
    var result = await api.serverInteraction.GetMessages(props.channelId, 10, currentSizeMsgs.value);
    if (result.length == 0) {
        hasEnded.value = true;
    }
    currentSizeMsgs.value += result.length;
    messages.value.push(...result);
}, {
    distance: 5,
    direction: "top",
    behavior: "smooth",
    idle: 1000,
    interval: 1000,
    onError(error) {
        logger.error("onError", error);
    },
    canLoadMore: (e) => {
        return !hasEnded.value;
    }
})

const currentSizeMsgs = ref(0);

onMounted(async () => {
    messages.value = await api.serverInteraction.GetMessages(props.channelId, 10, 0);
    currentSizeMsgs.value += messages.value.length;
    subs.value = pool.onNewMessageReceived.subscribe((e) => {
        if (props.channelId == e.ChannelId) {
            messages.value.unshift(e);
        }
    });
});

onUnmounted(() => {
    subs.value?.unsubscribe();
})

</script>

<style scoped>
.chat-scroll {
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column-reverse;
    /* Новые сообщения сверху */
}

.chat-message {
    padding: 8px;
    word-wrap: break-word;
}

.messages::-webkit-scrollbar {
    width: 6px;
}

.messages::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
}
</style>