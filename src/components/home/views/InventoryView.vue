<template>
    <section class="flex flex-col h-full space-y-4" v-bind="$attrs">
        <div class="flex items-center justify-between">
            <Alert class="flex justify-between items-center h-auto">
                <AlertTitle class="flex items-center gap-2 text-lg font-semibold">
                    <IconBasket />
                    {{ title }}
                </AlertTitle>

                <AlertDescription class="ml-auto">
                    <Input type="redeem" placeholder="Redeem..." class="w-full" v-model="redeemModel"
                        @keydown.enter="redeem" />
                </AlertDescription>
            </Alert>
            <br />
            <div class="flex items-center gap-2">
                <slot name="actions" />
            </div>
        </div>
        <div class="flex gap-3"
            :style="gridStyle">
            <Card v-for="i in slots" :key="i - 1" :class="[
                'aspect-square rounded-2xl border border-border border-dashed ring-offset-background transition hover:ring-1 hover:ring-muted-foreground/30 w-48 h-48',
                props.getCardClass ? props.getCardClass(i - 1) : ''
            ]" role="button" :aria-label="`Empty slot ${i}`" :aria-disabled="disabled ? 'true' : 'false'"
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
import Alert from '@/components/ui/alert/Alert.vue';
import AlertDescription from '@/components/ui/alert/AlertDescription.vue';
import AlertTitle from '@/components/ui/alert/AlertTitle.vue';
import { Card, CardContent } from '@/components/ui/card'
import Input from '@/components/ui/input/Input.vue';
import { IconBasket } from '@tabler/icons-vue';
import { computed, CSSProperties, ref } from 'vue'
defineOptions({ inheritAttrs: false })
const redeemModel = ref("");
const props = withDefaults(
    defineProps<{
        title?: string
        slots?: number
        disabled?: boolean
        minColWidth?: string
        getCardClass?: (index: number) => string
    }>(),
    { title: 'Inventory', slots: 24, disabled: false }
)


const emit = defineEmits<{
    (e: 'slot:click', index: number): void,
    (e: 'redeem', code: string): void,
}>()

function redeem() {
    emit('redeem', redeemModel.value);
    redeemModel.value = "";
}

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