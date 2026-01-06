<template>
    <section class="flex flex-col h-full space-y-4" v-bind="$attrs">
        <!-- Header with title and redeem input -->
        <div class="flex items-center justify-between gap-4">
            <Alert class="flex-1 flex justify-between items-center h-auto shadow-sm">
                <AlertTitle class="flex items-center gap-3 text-xl font-bold">
                    <div class="p-2 rounded-lg bg-primary/10">
                        <IconBasket class="w-6 h-6" />
                    </div>
                    <div class="flex flex-col">
                        <span>{{ title }}</span>
                        <span v-if="itemCount !== undefined" class="text-xs font-normal text-muted-foreground">
                            {{ itemCount }} / {{ slots }} items
                        </span>
                    </div>
                </AlertTitle>

                <AlertDescription class="ml-auto flex gap-2">
                    <Input 
                        type="text" 
                        :placeholder="t('inventory_redeem_placeholder')" 
                        class="w-64 transition-all focus:w-80" 
                        v-model="redeemModel"
                        @keydown.enter="redeem" 
                    />
                    <slot name="actions" />
                </AlertDescription>
            </Alert>
        </div>

        <!-- Loading skeleton -->
        <div v-if="loading" class="grid grid-cols-[repeat(auto-fill,12rem)] gap-3">
            <Card v-for="i in slots" :key="i" 
                class="group aspect-square rounded-2xl border-2 border-dashed border-border w-48 h-48 animate-pulse">
                <CardContent class="w-full h-full p-2 flex flex-col items-center justify-center gap-2">
                    <div class="w-28 h-28 bg-muted rounded-lg"></div>
                    <div class="w-24 h-4 bg-muted rounded"></div>
                </CardContent>
            </Card>
        </div>

        <!-- Empty state -->
        <div v-else-if="!loading && itemCount === 0" 
            class="flex-1 flex flex-col items-center justify-center gap-4 opacity-60">
            <IconBasket class="w-24 h-24 text-muted-foreground" stroke-width="1" />
            <p class="text-xl font-semibold text-muted-foreground">{{ t('inventory_empty') }}</p>
            <p class="text-sm text-muted-foreground">{{ t('inventory_empty_hint') }}</p>
        </div>

        <!-- Inventory grid -->
        <div v-else class="grid grid-cols-[repeat(auto-fill,12rem)] gap-3">
            <Card v-for="i in slots" :key="i - 1" :class="[
                'group aspect-square rounded-2xl border-2 ring-offset-background transition-all duration-300 w-48 h-48 cursor-pointer',
                props.getCardClass && props.getCardClass(i - 1) 
                    ? `${props.getCardClass(i - 1)} border-solid shadow-lg hover:shadow-2xl hover:scale-105 hover:-translate-y-1` 
                    : 'border-dashed border-border hover:border-solid hover:border-muted-foreground/50 hover:bg-muted/30',
                disabled && 'opacity-50 cursor-not-allowed'
            ]" 
            role="button" 
            :aria-label="hasItem(i - 1) ? t('inventory_item_slot', { slot: i }) : t('inventory_empty_slot', { slot: i })" 
            :aria-disabled="disabled ? 'true' : 'false'"
            :tabindex="disabled ? -1 : 0" 
            :data-index="i - 1" 
            @click="onClick(i - 1)"
            @keydown.enter.prevent="onClick(i - 1)" 
            @keydown.space.prevent="onClick(i - 1)">
                <CardContent class="w-full h-full p-4 flex items-center justify-center select-none relative overflow-hidden">
                    <slot name="item" :index="i - 1">
                        <!-- Default empty slot -->
                        <div class="flex items-center justify-center w-full h-full opacity-30 group-hover:opacity-50 transition-opacity">
                            <IconBasket class="w-16 h-16 text-muted-foreground" stroke-width="1.5" />
                        </div>
                    </slot>
                    <!-- Hover overlay effect -->
                    <div class="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
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
import { useLocale } from '@/store/localeStore';
import { IconBasket } from '@tabler/icons-vue';
import { computed, CSSProperties, ref } from 'vue'

defineOptions({ inheritAttrs: false })

const { t } = useLocale()
const redeemModel = ref("");

const props = withDefaults(
    defineProps<{
        title?: string
        slots?: number
        disabled?: boolean
        minColWidth?: string
        getCardClass?: (index: number) => string
        itemCount?: number
        loading?: boolean
        hasItem?: (index: number) => boolean
    }>(),
    { 
        title: 'Inventory', 
        slots: 24, 
        disabled: false,
        loading: false,
        hasItem: () => false
    }
)

const emit = defineEmits<{
    (e: 'slot:click', index: number): void,
    (e: 'redeem', code: string): void,
}>()

function redeem() {
    if (!redeemModel.value.trim()) return;
    emit('redeem', redeemModel.value);
    redeemModel.value = "";
}

function onClick(index: number) {
    if (props.disabled) return
    emit('slot:click', index)
}
</script>