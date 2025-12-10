<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from "vue"
import { useVirtualizer } from "@tanstack/vue-virtual"

type Msg = {
    id: string
    text: string
    from: string
}

const parentRef = ref<HTMLElement | null>(null)
const messages = ref<Msg[]>([])
const isLoading = ref(false)

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
    const el = parentRef.value!
    if (el.scrollTop < 100) {
        loadOlder()
    }
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
                        <div class="p-4 text-center text-gray-500">
                            No messages
                        </div>
                    </template>
                    <div class="p-2 flex" v-if="messages[item.index]" :class="messages[item.index].from === 'me'
                        ? 'justify-end'
                        : 'justify-start'">
                        <div class="px-3 py-2 rounded-lg max-w-[70%]" :class="messages[item.index].from === 'me'
                            ? 'bg-blue-600 text-white'
                            : 'bg-[#2a2a2a] text-gray-200'">
                            {{ messages[item.index].text }}
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>
