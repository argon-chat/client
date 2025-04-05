<template>
    <div ref="scroller" class="chat-scroll messages" @scroll="onScroll">
        <div :style="{ height: `${topSpacerHeight}px` }" />
        <div v-for="(message, index) in visibleMessages" :key="message.MessageId" class="chat-message">
            <MessageItem :message="message" />
        </div>
        <div :style="{ height: `${bottomSpacerHeight}px` }" />
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useChat } from '@/store/useChat'
import MessageItem from '@/components/MessageItem.vue'

const itemHeight = 80;
const buffer = 5;

const props = defineProps<{
    channelId: Guid;
}>()
const isAtBottom = ref(true)
const scroller = ref<HTMLElement | null>(null)
const scrollTop = ref(0)

const {
    messages,
    loadOlderMessages,
    loadInitial,
    isLoading,
    hasMore,
} = useChat(props.channelId)

const visibleStart = ref(0)
const visibleEnd = ref(0)

const totalCount = computed(() => messages.value.length)

const visibleMessages = computed(() =>
    messages.value.slice(visibleStart.value, visibleEnd.value)
)

const topSpacerHeight = computed(() => visibleStart.value * itemHeight)
const bottomSpacerHeight = computed(() => (totalCount.value - visibleEnd.value) * itemHeight)

function updateVisibleRange() {
    const el = scroller.value
    if (!el) return

    scrollTop.value = el.scrollTop
    const start = Math.floor(scrollTop.value / itemHeight) - buffer
    const end = Math.ceil((scrollTop.value + el.clientHeight) / itemHeight) + buffer

    visibleStart.value = Math.max(0, start)
    visibleEnd.value = Math.min(totalCount.value, end)
}

async function onScroll() {
    updateVisibleRange()

    const el = scroller.value
    if (!el || isLoading.value || !hasMore.value) return;

    isAtBottom.value = scroller.value
        ? scroller.value.scrollTop + scroller.value.clientHeight >= scroller.value.scrollHeight - 50
        : false;

    if (el.scrollTop < 100) {
        const prevScrollHeight = el.scrollHeight

        await loadOlderMessages()
        await nextTick()
        const newScrollHeight = el.scrollHeight
        el.scrollTop += newScrollHeight - prevScrollHeight

        updateVisibleRange()
    }


}

watch(() => messages.value.length, async () => {
  await nextTick()

  if (isAtBottom.value) {
    const el = scroller.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
    updateVisibleRange()
  }
})

onMounted(async () => {
    await loadInitial()
    await nextTick()

    const el = scroller.value
    if (el) {
        el.scrollTop = el.scrollHeight
        updateVisibleRange()
    }
})
</script>

<style scoped>
.chat-scroll {
    height: 100%;
    overflow-y: auto;
}

.chat-message {
    padding: 8px;
    height: 80px;
}

.messages::-webkit-scrollbar {
    width: 6px;
}

.messages::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
}
</style>