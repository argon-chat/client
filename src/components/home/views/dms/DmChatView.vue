<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted, shallowRef } from "vue"
import { useVirtualizer } from "@tanstack/vue-virtual"

type Msg = {
    id: string
    text: string
    from: string
}

const parentRef = ref<HTMLElement | null>(null)
const messages = shallowRef<Msg[]>([])
const isLoading = shallowRef(false)
let scrollDebounceTimer: number | null = null

const virtualizer = useVirtualizer({
    count: 0,
    getScrollElement: () => parentRef.value!,
    estimateSize: () => 60,
    overscan: 10,
    measureElement: el =>
        (el as HTMLElement).getBoundingClientRect().height,
})

watch(messages, async () => {
    const count = messages.value.length === 0 ? 1 : messages.value.length

    virtualizer.value.setOptions({
        ...virtualizer.value.options,
        count,
    })

    await nextTick()
    virtualizer.value.calculateRange()
})
async function loadOlder() {
    if (isLoading.value) return
    isLoading.value = true

    await new Promise(r => setTimeout(r, 200))

    const older = Array.from({ length: 1 }).map((_, i) => ({
        id: crypto.randomUUID(),
        text: "Old message " + i,
        from: Math.random() > 0.5 ? "me" : "them"
    }))

    const first = virtualizer.value.getVirtualItems()[0]
    const prevOffset = first?.start ?? 0

    messages.value = [...older, ...messages.value]

    await nextTick()

    virtualizer.value.scrollToOffset(prevOffset + older.length * 60)

    isLoading.value = false
}

function onScroll() {
    if (scrollDebounceTimer !== null) {
        clearTimeout(scrollDebounceTimer);
    }
    scrollDebounceTimer = setTimeout(() => {
        const el = parentRef.value;
        if (el && el.scrollTop < 100) {
            loadOlder();
        }
        scrollDebounceTimer = null;
    }, 150) as unknown as number;
}

onMounted(async () => {
    messages.value = Array.from({ length: 0 }).map((_, i) => ({
        id: String(i),
        text: "Message " + i,
        from: Math.random() > 0.5 ? "me" : "them"
    }))

    await nextTick()

    virtualizer.value.scrollToIndex(messages.value.length - 1, {
        align: "end"
    })
})

onUnmounted(() => {
    if (scrollDebounceTimer !== null) {
        clearTimeout(scrollDebounceTimer);
        scrollDebounceTimer = null;
    }
    messages.value = [];
})
</script>
<template>
    <div ref="parentRef" class="h-full overflow-y-auto" @scroll="onScroll">

        <div :style="{
            height: virtualizer.getTotalSize() + 'px',
            width: '100%',
            position: 'relative'
        }">
            <template v-for="item in virtualizer.getVirtualItems()" :key="item.key">
                <!-- @vue-ignore -->
                <div :data-index="item.index" :ref="el => el && virtualizer.measureElement(el)" :style="{
                    position: 'absolute',
                    top: 0,
                    transform: `translateY(${item.start}px)`,
                    width: '100%'
                }">
                    <template v-if="messages.length === 0 && item.index === 0">
                        <div class="p-4 text-center text-muted-foreground">
                            No messages
                        </div>
                    </template>
                    <div class="p-2 flex" v-if="messages[item.index]" :class="messages[item.index].from === 'me'
                        ? 'justify-end'
                        : 'justify-start'">
                        <div class="px-3 py-2 rounded-lg max-w-[70%] border" :class="messages[item.index].from === 'me'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card text-foreground border-border'">
                            {{ messages[item.index].text }}
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>
