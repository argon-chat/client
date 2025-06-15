<template>
    <Popover v-model:open="isOpened">
        <PopoverContent style="width: 19rem;min-height: 25rem;"
            class="p-0 rounded-2xl shadow-xl border border-neutral-800 bg-[#09090b] text-white overflow-hidden">
            <UserProfilePopover :user-id="user!.UserId" @close:pressed="isOpened = false" />
        </PopoverContent>
        <PopoverTrigger>
            <span
                class="bg-orange-700/70 font-bold px-1 rounded-full border border-red-500/70 shadow-md shadow-orange-500/50"
                v-if="isForMeMention">@{{ user?.Username }}</span>
            <span class="text-blue-400 font-semibold" v-else>@{{ user?.Username }}</span>
        </PopoverTrigger>
    </Popover>
</template>
<script setup lang="ts" generic="T extends IMessageEntityMention">
import type { RealtimeUser } from "@/store/db/dexie";
import { useMe } from "@/store/meStore";
import { usePoolStore } from "@/store/poolStore";
import { computed, onMounted, ref } from "vue";
import UserProfilePopover from "../UserProfilePopover.vue";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

const isOpened = ref(false);
const pool = usePoolStore();

const props = defineProps<{
  entity: T;
  text: string;
}>();

const user = ref(undefined as RealtimeUser | undefined);
const me = useMe();

const isForMeMention = computed(() => user.value?.UserId === me.me?.Id);

onMounted(async () => {
  user.value = await pool.getUser(props.entity.UserId);
});
</script>