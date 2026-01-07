<script setup lang="ts">
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { RealtimeUser } from "@/store/db/dexie";
import { usePoolStore } from "@/store/poolStore";
import { useCallManager } from "@/store/callManagerStore";
import { IconPhone } from "@tabler/icons-vue";
import { onUnmounted, shallowRef, watch, computed } from "vue";

const pool = usePoolStore();
const calls = useCallManager();

const props = defineProps({
    userId: { type: String, required: true }
});

const user = shallowRef<RealtimeUser | null>(null);

const emit = defineEmits<{
    (e: "call"): void;
}>();

const isAlreadyInCall = computed(() => {
    return calls.activePeerId === props.userId && calls.activeCallId !== null;
});

const stopWatch = watch(
    () => props.userId,
    async (newUserId, oldUserId) => {
        if (!newUserId) {
            user.value = null;
            return;
        }

        if (newUserId === oldUserId) return;

        user.value = (await pool.getUser(newUserId)) ?? null;
    },
    { immediate: true }
);

onUnmounted(() => {
    stopWatch();
    user.value = null;
});

</script>

<template>
    <div class="flex items-center justify-between px-4 py-3 border-b border-border">
        <div class="flex items-center gap-3">
            <div
                class="w-10 h-10 rounded-full overflow-hidden bg-muted flex items-center justify-center text-foreground font-semibold">
                <SmartArgonAvatar :user-id="userId" />
            </div>

            <div class="font-bold text-lg">
                {{ user?.displayName }}
            </div>
        </div>

        <div class="flex items-center gap-3">
            <button 
                class="p-2 rounded-full bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed" 
                :disabled="isAlreadyInCall"
                @click="emit('call')">
                <IconPhone class="w-5 h-5" />
            </button>
        </div>
    </div>
</template>
