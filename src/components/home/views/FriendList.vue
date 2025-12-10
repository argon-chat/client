<template>
    <ScrollArea class="h-[60vh] rounded border p-2">
        <div v-if="items.length > 0" class="space-y-3">
            <FriendListItem v-for="item in items" :key="item.userId" :item="item" @accept="$emit('accept', $event)"
                @decline="$emit('decline', $event)" @cancel="$emit('cancel', $event)" @unfriend="$emit('unfriend', $event)" />
        </div>

        <div v-else class="text-sm text-muted-foreground italic p-4">
            {{ t("empty_section") }}
        </div>
    </ScrollArea>
</template>

<script setup lang="ts">
import { ScrollArea } from "@/components/ui/scroll-area";
import FriendListItem from "./FriendListItem.vue";
import type { FriendListItemVm } from "./FriendListItem.vue";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();

defineProps<{
    items: FriendListItemVm[];
}>();

const emit = defineEmits(["accept", "decline", "cancel", "unfriend"]);

</script>
