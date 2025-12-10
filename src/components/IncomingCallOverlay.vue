<template>
    <div v-if="caller" class="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-lg flex items-center justify-center">
        <Card class="w-[320px] p-6 space-y-5 animate-in fade-in zoom-in duration-200">
            <div class="flex flex-col items-center gap-4">
                <SmartArgonAvatar :overrided-size="120" :user-id="caller.userId" />

                <div class="text-center">
                    <h2 class="text-xl font-bold">Incoming Call</h2>
                    <p class="text-neutral-200 text-base">
                        {{ caller.displayName }}
                    </p>
                    <p class="text-neutral-400 text-sm">
                        @{{ caller.username }}
                    </p>
                </div>
            </div>

            <div class="flex gap-6 justify-center pt-2">
                <button @click="accept" class="h-16 w-16 rounded-full flex items-center justify-center 
           bg-neutral-800 text-green-500
           hover:bg-green-600 hover:text-white 
           transition-all duration-150 shadow-lg">
                    <PhPhoneIncoming class="h-6 w-6" />
                </button>

                <button @click="reject"
                    :disabled="callStore.incomingCall?.fromId == 'b7404c69-abf2-4d73-b7b0-f4f232c85815'" class="h-16 w-16 rounded-full flex items-center justify-center
         transition-all duration-150 shadow-lg
         disabled:shadow-none
         disabled:bg-neutral-700 disabled:text-neutral-400
         disabled:cursor-not-allowed
         bg-neutral-800 text-red-500
         hover:bg-red-600 hover:text-white
         disabled:hover:bg-neutral-700 disabled:hover:text-neutral-400">
                    <PhPhoneSlash class="h-6 w-6" />
                </button>
            </div>
        </Card>
    </div>
</template>


<script setup lang="ts">
import SmartArgonAvatar from './SmartArgonAvatar.vue';
import { PhPhoneIncoming, PhPhoneSlash } from "@phosphor-icons/vue"
import { useCallManager } from '@/store/callManagerStore';
import { ref, watch } from 'vue';
import { usePoolStore } from '@/store/poolStore';
import { Guid } from '@argon-chat/ion.webcore';
import Card from './ui/card/Card.vue';

const callStore = useCallManager();
const pool = usePoolStore();

const caller = ref<{
    username: string;
    displayName: string;
    userId: Guid;
} | null>(null);

watch(
    () => callStore.incomingCall,
    async (newCall) => {
        if (!newCall) {
            caller.value = null;
            return;
        }

        const userId = newCall.fromId;

        try {
            const user = await pool.getUser(userId);

            caller.value = {
                username: user?.username ?? "unknown",
                displayName: user?.displayName ?? user?.username ?? "unknown",
                userId
            };
        } catch (err) {
            console.error("Failed to load user:", err);
            caller.value = {
                username: "unknown",
                displayName: "unknown",
                userId
            };
        }
    },
    { immediate: true }
);

const accept = async () => {
    await callStore.acceptIncomingCall()
};

const reject = async () => {
    await callStore.rejectIncomingCall();
};
</script>