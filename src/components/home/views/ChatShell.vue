<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCallManager } from "@/store/callManagerStore";
import DmChatView from "./dms/DmChatView.vue";
import ChatInput from "./dms/ChatInput.vue";
import ChatPanel from "./dms/ChatPanel.vue";
import ChatHeader from "./dms/ChatHeader.vue";
import { useUnifiedCall } from "@/store/unifiedCallStore";
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";

const route = useRoute();
const router = useRouter();

const dmCall = useUnifiedCall();
const calls = useCallManager();

const userId = computed(() => route.params.userId as string | undefined);

watch(
  userId,
  async (newUserId, oldUserId) => {
    if (!newUserId) return;
    if (newUserId === oldUserId) return;

    console.warn("Switch DM:", oldUserId, "→", newUserId);

    isProfileOpen.value = false;
  },
  { immediate: true }
);

const isProfileOpen = ref(false);

async function onCall() {
    if (!userId.value) return;
    await calls.startOutgoingCall(userId.value);
}

async function onVideoCall() {
    if (!userId.value) return;
    await calls.startOutgoingCall(userId.value);
}

const isCallActive = computed(() => {
    return (
        calls.activeCallId &&
        calls.activePeerId === userId.value &&
        dmCall.isConnected
    );
});


function toggleProfile() {
    isProfileOpen.value = !isProfileOpen.value;
}

function endCall() {
    if (calls.activeCallId) {
        calls.hangupCall();
    }
}
</script>
<template>
    <div class="flex flex-col flex-1 overflow-hidden rounded-xl bg-[#161616f5]">
        <ChatHeader :user-id="userId!" @call="onCall" @videoCall="onVideoCall" @toggleProfile="toggleProfile" />

        <div class="flex flex-row flex-1 overflow-hidden">

            <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
                <ChatPanel v-if="isCallActive" @end="endCall" />
                <DmChatView class="flex-1" />
                <ChatInput />
            </div>

            <transition name="slide-profile">
                <div v-if="isProfileOpen"
                    class="w-80 min-w-[20rem] max-w-[20rem] flex flex-col border-l border-white/10 bg-[#1e1e1e]">

                    <div class="p-4 overflow-y-auto flex flex-col gap-3">
                        <SmartArgonAvatar :user-id="userId!" class="w-20 h-20 rounded-full" />

                        <div class="text-xl font-semibold">
                            123
                        </div>

                        <div class="text-white/50 text-sm">
                            User ID: {{ userId }}
                        </div>
                    </div>
                </div>
            </transition>

        </div>
    </div>
</template>
