<template>
    <section class="w-full space-y-4">
        <div class="flex items-center justify-between">
            <Alert class="flex justify-between items-center h-auto">
                <AlertTitle class="flex items-center gap-2 text-lg font-semibold">
                    <IconMail />
                    Notifications
                </AlertTitle>
            </Alert>
            <br />
            <div class="flex items-center gap-2">
                <slot name="actions" />
            </div>
        </div>
        <div v-if="!items?.length"
            class="flex flex-col items-center justify-center rounded-xl border border-border/50 py-14 text-center h-1/2"
            style="background-color: #161616f5;">
            <IconMail class="w-16 h-16" />
            <p class="mt-3 text-sm text-muted-foreground">There are no new notifications</p>
        </div>

        <div v-else class="space-y-2">
            <Card v-for="n in items" :key="n.id" class="group relative overflow-hidden">
                <button class="w-full text-left" type="button" @click="onClick(n)">
                    <CardContent class="flex items-start gap-3 p-4">
                        <span class="mt-1 inline-block h-2.5 w-2.5 rounded-full"
                            :class="n.unread ? 'bg-primary' : 'bg-muted'" />

                        <div class="min-w-0 flex-1">
                            <div class="flex items-center justify-between gap-3">
                                <p class="truncate text-sm font-medium leading-6">
                                    {{ n.title }}
                                </p>
                                <time class="shrink-0 text-[11px] text-muted-foreground">
                                    {{ formatTime(n.createdAt) }}
                                </time>
                            </div>
                            <p class="mt-1 line-clamp-2 text-sm text-muted-foreground">
                                {{ n.message }}
                            </p>

                            <div v-if="n.meta && n.meta.tags?.length" class="mt-2 flex flex-wrap gap-1">
                                <span v-for="t in n.meta.tags" :key="t"
                                    class="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                    {{ t }}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </button>
            </Card>
        </div>
    </section>
</template>

<script setup lang="ts">
import Alert from '@/components/ui/alert/Alert.vue'
import AlertDescription from '@/components/ui/alert/AlertDescription.vue'
import AlertTitle from '@/components/ui/alert/AlertTitle.vue'
import { Card, CardContent } from '@/components/ui/card'
import { IconMail } from "@tabler/icons-vue"
export interface NotificationItem {
    id: string
    title: string
    message?: string
    createdAt: string | number | Date
    unread?: boolean
    kind?: 'info' | 'success' | 'warning' | 'error'
    meta?: { tags?: string[] }
}

const props = withDefaults(defineProps<{ items?: NotificationItem[] }>(), { items: () => [] })
const emit = defineEmits<{ (e: 'item:click', item: NotificationItem): void }>()

function onClick(item: NotificationItem) {
    emit('item:click', item)
}

function formatTime(v: string | number | Date): string {
    try {
        const d = new Date(v)
        const now = new Date()
        const diff = (now.getTime() - d.getTime()) / 1000
        if (diff < 60) return 'только что'
        if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
        if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
        return d.toLocaleDateString()
    } catch {
        return ''
    }
}
</script>

<style scoped></style>
