<template>
    <div v-if="callStore.incomingCallInfo"
        class="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-lg flex items-center justify-center">
        <Card class="w-[320px] p-6 space-y-5 animate-in fade-in zoom-in duration-200">
            <div class="flex flex-col items-center gap-4">
                <SmartArgonAvatar :overrided-size="120" :user-id="callStore.incomingCallInfo.fromUserId" />

                <div class="text-center">
                    <h2 class="text-xl font-bold">InCuming Call</h2>
                    <p class="text-neutral-500 text-sm">
                        from @{{ callStore.incomingCallInfo.fromUserUsername }}
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

                <button @click="reject" :disabled="callStore.incomingCallInfo.callId == 'b7404c69-abf2-4d73-b7b0-f4f232c85815'" class="h-16 w-16 rounded-full flex items-center justify-center
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
import { useCallStore } from '@/store/callStore';
import SmartArgonAvatar from './SmartArgonAvatar.vue';
import Button from './ui/button/Button.vue';
import { PhPhoneIncoming, PhPhoneSlash } from "@phosphor-icons/vue"
import { usePoolStore } from '@/store/poolStore';
import { watch } from 'vue';

const callStore = useCallStore();

const accept = async () => {
    //await callStore.();
};

const reject = async () => {
    await callStore.rejectCall();
};
</script>
