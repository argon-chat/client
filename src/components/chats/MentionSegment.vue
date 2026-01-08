<template>
    <Popover v-model:open="isOpened">
        <PopoverContent style="width: 19rem;min-height: 25rem;"
            class="p-0 rounded-2xl shadow-xl border border-border bg-popover text-popover-foreground overflow-hidden">
            <UserProfilePopover :user-id="user!.userId" @close:pressed="isOpened = false" />
        </PopoverContent>
        <PopoverTrigger>
            <span class="mention" :class="{ 'mention--me': isForMeMention }">
                <span class="mention__icon">@</span>
                <span class="mention__name">{{ user?.username }}</span>
            </span>
        </PopoverTrigger>
    </Popover>
</template>
<script setup lang="ts" generic="T extends MessageEntityMention">
import type { RealtimeUser } from "@/store/db/dexie";
import { useMe } from "@/store/meStore";
import { usePoolStore } from "@/store/poolStore";
import { computed, ref } from "vue";
import UserProfilePopover from "../popovers/UserProfilePopover.vue";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { MessageEntityMention } from "@/lib/glue/argonChat";

const isOpened = ref(false);
const pool = usePoolStore();

const props = defineProps<{
  entity: T;
  text: string;
}>();

const user = computed(() => pool.getUserReactive(computed(() => props.entity.userId)).value);
const me = useMe();

const isForMeMention = computed(() => user.value?.userId === me.me?.userId);
</script>

<style scoped>
.mention {
    display: inline;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease;
    color: hsl(var(--primary));
}

.mention:hover {
    text-decoration: underline;
}

.mention__icon {
    opacity: 0.8;
}

.mention__name {
    font-weight: 600;
}

/* Highlighted mention for current user */
.mention--me {
    color: hsl(var(--destructive));
    font-weight: 700;
}

.mention--me .mention__icon {
    opacity: 1;
}
</style>