<template>
    <section class="w-full space-y-4">
        <!-- Header -->
        <div class="flex items-center justify-between">
            <h2 class="text-2xl font-semibold tracking-tight">{{ title }}</h2>
            <div class="flex items-center gap-2">
                <!-- Optional actions slot (filters, buttons, etc.) -->
                <slot name="actions" />
            </div>
        </div>


        <!-- Grid of empty inventory slots -->
        <div class="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"
            :style="gridStyle">
            <Card v-for="i in slots" :key="i - 1"
                class="aspect-square rounded-2xl border border-border border-dashed ring-offset-background transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:ring-1 hover:ring-muted-foreground/30"
                role="button" :aria-label="`Empty slot ${i}`" :aria-disabled="disabled ? 'true' : 'false'"
                :tabindex="disabled ? -1 : 0" :data-index="i - 1" @click="onClick(i - 1)"
                @keydown.enter.prevent="onClick(i - 1)" @keydown.space.prevent="onClick(i - 1)">
                <CardContent class="w-full h-full p-0 flex items-center justify-center select-none">
                    <slot name="item" :index="i - 1" />
                </CardContent>
            </Card>
        </div>
    </section>
</template>

<script setup lang="ts">
import { Card, CardContent } from '@/components/ui/card'
import { computed, CSSProperties } from 'vue'


/**
* InventoryView — простая вьюшка инвентаря с заголовком и сеткой пустых слотов.
*
* Props:
* - title: заголовок (по умолчанию "Инвентарь")
* - slots: число слотов (по умолчанию 24)
* - disabled: отключение кликов по слотам
* - minColWidth: минимальная ширина слота (для auto-fit сетки, опционально)
*
* Emits:
* - slot:click (index: number)
*/
const props = withDefaults(
    defineProps<{
        title?: string
        slots?: number
        disabled?: boolean
        minColWidth?: string
    }>(),
    { title: 'Inventory', slots: 24, disabled: false }
)


const emit = defineEmits<{ (e: 'slot:click', index: number): void }>()


function onClick(index: number) {
    if (props.disabled) return
    emit('slot:click', index)
}


const gridStyle = computed<CSSProperties | undefined>(() =>
    props.minColWidth
        ? {
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${props.minColWidth}, 1fr))`,
            gap: '0.75rem',
        }
        : undefined
)
</script>