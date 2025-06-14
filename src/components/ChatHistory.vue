<template>
    <div class="chat-scroller" ref="scrollContainer" @scroll.passive="handleScroll">
        <div class="scroll-padder" :style="padderStyle">
            <div v-if="loading" class="loading-indicator">
                Загрузка истории...
            </div>

            <div v-for="message in visibleMessages" :key="message.MessageId" class="message-item">
                {{ message.Text }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  type Ref,
  watch,
  nextTick,
} from "vue";

interface Props {
  items: IArgonMessage[];
}

const props = defineProps<Props>();
const emit = defineEmits<(e: "load-more", page: number) => void>();

// Состояния
const scrollContainer: Ref<HTMLElement | null> = ref(null);
const loading = ref(false);
const page = ref(1);
const scrollHeightBeforeLoad = ref(0);
const itemHeight = 80;
const scrollToBottomOnNextTick = ref(false);

// Вычисляемые свойства
const visibleMessages = computed(() => props.items);
const padderStyle = computed(() => ({
  paddingTop: `${props.items.length * itemHeight - (scrollContainer.value?.clientHeight || 0)}px`,
}));

// Методы
const loadMoreMessages = async () => {
  if (loading.value || !scrollContainer.value) return;

  loading.value = true;
  scrollHeightBeforeLoad.value = scrollContainer.value.scrollHeight;

  try {
    emit("load-more", page.value);
    page.value++;
    await nextTick();
    restoreScrollPosition();
  } finally {
    loading.value = false;
  }
};

const restoreScrollPosition = () => {
  const container = scrollContainer.value;
  if (!container) return;

  const newScrollHeight = container.scrollHeight;
  const diff = newScrollHeight - scrollHeightBeforeLoad.value;

  container.scrollTop = container.scrollTop + diff;
};

const handleScroll = (event: Event) => {
  const container = event.target as HTMLElement;
  const { scrollTop, clientHeight, scrollHeight } = container;

  if (scrollTop < 100 && !loading.value) {
    loadMoreMessages();
  }

  const isNearBottom = scrollHeight - (scrollTop + clientHeight) < 50;
  if (isNearBottom && !loading.value) {
    scrollToBottom();
  }
};

const scrollToBottom = () => {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
  }
};

// Хуки жизненного цикла
onMounted(() => {
  scrollToBottom();
  window.addEventListener("resize", scrollToBottom);
});

onUnmounted(() => {
  window.removeEventListener("resize", scrollToBottom);
});

watch(
  () => props.items.length,
  async () => {
    if (scrollToBottomOnNextTick.value) {
      await nextTick();
      scrollToBottom();
      scrollToBottomOnNextTick.value = false;
    }
  },
);
</script>

<style>
/* Стили остаются без изменений */
.chat-scroller {
    height: 100vh;
    overflow-y: auto;
    position: relative;
    scroll-behavior: smooth;
}

.scroll-padder {
    min-height: 100%;
    box-sizing: border-box;
}

.loading-indicator {
    padding: 16px;
    text-align: center;
    background: #f5f5f5;
    position: sticky;
    top: 0;
    z-index: 1;
}

.message-item {
    padding: 12px;
    contain: strict;
    box-sizing: border-box;
    min-height: v-bind(itemHeight + 'px');
}
</style>
