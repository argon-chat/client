<script setup lang="ts">
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { UserStatus } from "@/lib/glue/argonChat";
import { useMe } from "@/store/meStore";

const me = useMe();

const props = defineProps<{
    userId: string;
    displayName: string;
    lastMessage?: string | null;
    status?: UserStatus;
}>();

const emit = defineEmits<{
    (e: "open", userId: string): void;
}>();

</script>

<template>
    <div class="recent-user flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-[#ffffff0a] min-w-0"
        @click="emit('open', userId)">
        <div class="relative w-[40px] h-[40px] shrink-0">
            <SmartArgonAvatar :user-id="userId" :overrided-size="40" />

            <span v-if="false" :class="me.statusClass(status ?? UserStatus.Offline)"
                class="absolute bottom-0 right-0 w-4 h-3 rounded-full border-2 border-gray-800"></span>
        </div>

        <div class="flex flex-col flex-1 overflow-hidden min-w-0">

            <div class="text-sm font-medium truncate">
                {{ displayName }}
            </div>

            <div v-if="lastMessage"
                class="relative text-xs text-gray-400 flex-1 min-w-0 max-w-full overflow-hidden flex">
                <span class="block overflow-hidden whitespace-nowrap text-ellipsis min-w-0 flex-1"
                    style="min-width: 0 !important; max-width: 100% !important; display: block;">
                    {{ lastMessage }}
                </span>

                <!-- <div class="absolute top-0 right-0 h-full pointer-events-none"
                    style="width: 30px; background: linear-gradient(to right, transparent, #161616); " /> -->
            </div>

            <div v-else class="text-xs text-gray-500 italic truncate">
            </div>

        </div>
    </div>
</template>

<style scoped>
.recent-user {
    transition: background-color 0.15s ease;
}
</style>
