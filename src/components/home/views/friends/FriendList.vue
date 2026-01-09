<template>
    <div class="flex-1 flex flex-col overflow-hidden">
        <ScrollArea class="flex-1 rounded border p-2">
            <div v-if="items.length > 0" class="space-y-1">
                <FriendListItem 
                    v-for="item in items" 
                    :key="item.userId" 
                    :item="item" 
                    :disabled="loading"
                    @accept="$emit('accept', $event)"
                    @decline="$emit('decline', $event)" 
                    @cancel="$emit('cancel', $event)" 
                    @unfriend="$emit('unfriend', $event)" 
                />
            </div>

            <div v-else class="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
                <svg class="w-16 h-16 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <p class="text-sm font-medium">{{ t("empty_section") }}</p>
                <p class="text-xs mt-1">{{ t("no_items_found") }}</p>
            </div>
        </ScrollArea>
    </div>
</template>

<script setup lang="ts">
import { ScrollArea } from "@argon/ui/scroll-area";
import FriendListItem from "./FriendListItem.vue";
import type { FriendListItemVm } from "./FriendListItem.vue";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();

defineProps<{
    items: FriendListItemVm[];
    loading?: boolean;
}>();

const emit = defineEmits(["accept", "decline", "cancel", "unfriend"]);

</script>
