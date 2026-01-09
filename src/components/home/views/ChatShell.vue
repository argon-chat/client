<script setup lang="ts">
import { computed, shallowRef, watch, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCallManager } from "@/store/callManagerStore";
import DmChatView from "./dms/DmChatView.vue";
import ChatInput from "./dms/ChatInput.vue";
import ChatPanel from "./dms/ChatPanel.vue";
import ChatHeader from "./dms/ChatHeader.vue";
import { useUnifiedCall } from "@/store/unifiedCallStore";
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { DirectMessage } from "@argon/glue";
import { usePoolStore } from "@/store/poolStore";

const route = useRoute();
const router = useRouter();

const dmCall = useUnifiedCall();
const calls = useCallManager();
const pool = usePoolStore();

const userId = computed(() => route.params.userId as string | undefined);
const isProfileOpen = shallowRef(false);
const replyTo = ref<DirectMessage | null>(null);

const peerName = computed(() => {
    if (!userId.value) return undefined;
    // Get user from pool if available
    // This is a placeholder - adjust based on your actual user storage
    return undefined;
});

const stopUserIdWatch = watch(
  userId,
  async (newUserId, oldUserId) => {
    if (!newUserId) return;
    if (newUserId === oldUserId) return;

    isProfileOpen.value = false;
    replyTo.value = null;
  },
  { immediate: true }
);

async function onCall() {
    if (!userId.value) return;
    await calls.startOutgoingCall(userId.value);
}

const isCallActive = computed(() => {
    const uid = userId.value;
    if (!uid) return false;
    return (
        calls.activeCallId &&
        calls.activePeerId === uid &&
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

function onReplySelect(message: DirectMessage) {
    replyTo.value = message;
}

onUnmounted(() => {
    stopUserIdWatch();
    isProfileOpen.value = false;
    replyTo.value = null;
});
</script>
<template>
    <div class="flex flex-col flex-1 overflow-hidden rounded-xl bg-card border border-border">
        <ChatHeader :user-id="userId!" @call="onCall" />

        <div class="flex flex-row flex-1 overflow-hidden">

            <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
                <ChatPanel v-if="isCallActive" @end="endCall" />
                <DmChatView v-if="userId" :peer-id="userId" :peer-name="peerName" class="flex-1" @select-reply="onReplySelect" />
                <div class="message-input p-5 overflow-hidden flex-shrink-0 bg-card">
                    <ChatInput v-if="userId" :receiver-id="userId" :reply-to="replyTo" @clear-reply="replyTo = null" />
                </div>
            </div>

            <transition name="slide-profile">
                <div v-if="isProfileOpen"
                    class="w-80 min-w-[20rem] max-w-[20rem] flex flex-col border-l border-border bg-card">

                    <div class="p-4 overflow-y-auto flex flex-col gap-3">
                        <SmartArgonAvatar :user-id="userId!" class="w-20 h-20 rounded-full" />

                        <div class="text-xl font-semibold">
                            123
                        </div>

                        <div class="text-muted-foreground text-sm">
                            User ID: {{ userId }}
                        </div>
                    </div>
                </div>
            </transition>

        </div>
    </div>
</template>
