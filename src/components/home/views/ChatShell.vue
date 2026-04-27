<script setup lang="ts">
import { computed, shallowRef, watch, onUnmounted, ref, nextTick } from "vue";
import { useRoute } from "vue-router";
import { useCallManager } from "@/store/media/callManagerStore";
import DmChatView from "./dms/DmChatView.vue";
import ChatInput from "./dms/ChatInput.vue";
import ChatPanel from "./dms/ChatPanel.vue";
import ChatHeader from "./dms/ChatHeader.vue";
import CallConnecting from "./dms/CallConnecting.vue";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useUserColors } from "@/store/chat/userColors";
import { useLocale } from "@/store/system/localeStore";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { PaperclipIcon, XIcon, ReplyIcon, MessageSquareIcon, PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-vue-next";
import type { ArgonMessage } from "@argon/glue";

const route = useRoute();
const dmCall = useUnifiedCall();
const calls = useCallManager();
const pool = usePoolStore();
const userColors = useUserColors();
const { t } = useLocale();

// ── Refs ──

const chatViewRef = ref<InstanceType<typeof DmChatView> | null>(null);
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);

const userId = computed(() => route.params.userId as string | undefined);
const isProfileOpen = shallowRef(false);
const replyTo = ref<ArgonMessage | null>(null);
const isDragging = ref(false);

/** Whether the chat sidebar is open during a call */
const chatSidebarOpen = ref(true);

/** Local flag: true from moment user clicks call until callManager takes over */
const isDialing = ref(false);

// ── Peer lifecycle ──

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

// ── Call management ──

async function onCall() {
    if (!userId.value) return;
    isDialing.value = true;
    try {
        await calls.startOutgoingCall(userId.value);
    } finally {
        isDialing.value = false;
    }
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

/** Call initiated but not yet connected (API call + LiveKit handshake in progress) */
const isCallConnecting = computed(() => {
    const uid = userId.value;
    if (!uid) return false;
    // Local dialing flag covers the gap before callManager sets activePeerId
    if (isDialing.value) return true;
    return (
        calls.activePeerId === uid &&
        !dmCall.isConnected &&
        (dmCall.isConnecting || !!calls.activeCallId)
    );
});

function endCall() {
    if (calls.activeCallId) {
        calls.hangupCall();
    }
}

function cancelOutgoingCall() {
    isDialing.value = false;
    calls.hangupCall();
}

// ── Reply state ──

const replySenderId = computed(() => replyTo.value?.sender);
const replySender = pool.getUserReactive(replySenderId as any);
const replySenderName = computed(() => replySender.value?.displayName || t("unknown_display_name"));
const replyColor = computed(() => userColors.getColorByUserId(replyTo.value?.sender ?? ""));

function onSelectReply(msg: ArgonMessage) {
    replyTo.value = msg;
    nextTick(() => chatInputRef.value?.focus?.());
}

function clearReply() {
    replyTo.value = null;
}

watch(replyTo, (val) => {
    if (val) nextTick(() => chatViewRef.value?.scrollToBottomImmediate());
});

// ── Optimistic message bridge (ChatInput → DmChatView) ──

function onAddOptimistic(msg: ArgonMessage, randomId: bigint) {
    chatViewRef.value?.addOptimisticMessage(msg, randomId);
    nextTick(() => chatViewRef.value?.scrollToBottomImmediate());
}

function onResolveOptimistic(randomId: bigint, readback: { messageId: bigint }) {
    chatViewRef.value?.resolveOptimisticMessage(randomId, readback);
}

function onMarkFailed(randomId: bigint, error: string) {
    chatViewRef.value?.markOptimisticFailed(randomId, error);
}

// ── Drag & drop ──

let _dragCounter = 0;

function onDragOver() {
    _dragCounter++;
    isDragging.value = true;
}

function onDragLeave() {
    _dragCounter--;
    if (_dragCounter <= 0) {
        _dragCounter = 0;
        isDragging.value = false;
    }
}

function onDrop(e: DragEvent) {
    _dragCounter = 0;
    isDragging.value = false;
    if (e.dataTransfer?.files?.length && chatInputRef.value) {
        chatInputRef.value.handleExternalFiles?.(e.dataTransfer.files);
    }
}

// ── Profile ──

function toggleProfile() {
    isProfileOpen.value = !isProfileOpen.value;
}

onUnmounted(() => {
    stopUserIdWatch();
    isProfileOpen.value = false;
    replyTo.value = null;
});
</script>
<template>
    <div
        class="flex flex-col flex-1 overflow-hidden rounded-xl bg-card border border-border relative"
        @dragover.prevent="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
    >
        <!-- Drag-drop overlay -->
        <Transition
            enter-active-class="transition duration-200 ease-out"
            leave-active-class="transition duration-150 ease-in"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
        >
            <div
                v-if="isDragging"
                class="absolute inset-0 z-50 rounded-xl border-2 border-dashed border-primary bg-primary/[0.06] backdrop-blur-[2px] flex items-center justify-center"
            >
                <div class="flex flex-col items-center gap-2.5 text-primary">
                    <div class="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                        <PaperclipIcon class="w-7 h-7" />
                    </div>
                    <span class="text-sm font-medium">{{ t('drop_files_here') || 'Drop files here' }}</span>
                </div>
            </div>
        </Transition>

        <ChatHeader :user-id="userId!" @call="onCall">
            <!-- Chat sidebar toggle (only during call) -->
            <template v-if="isCallActive" #actions>
                <button
                    class="p-2 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                    :title="chatSidebarOpen ? 'Hide chat' : 'Show chat'"
                    @click="chatSidebarOpen = !chatSidebarOpen"
                >
                    <PanelRightCloseIcon v-if="chatSidebarOpen" class="w-5 h-5" />
                    <PanelRightOpenIcon v-else class="w-5 h-5" />
                </button>
            </template>
        </ChatHeader>

        <!-- ═══ Connecting overlay ═══ -->
        <Transition
            enter-active-class="transition-opacity duration-300 ease-out"
            leave-active-class="transition-opacity duration-200 ease-in"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
        >
            <CallConnecting
                v-if="isCallConnecting && userId"
                :peer-id="userId"
                @cancel="cancelOutgoingCall"
            />
        </Transition>

        <!-- ═══ NO CALL: normal vertical layout ═══ -->
        <div v-if="!isCallActive" class="flex flex-col flex-1 min-h-0 overflow-hidden">
            <DmChatView
                v-if="userId"
                ref="chatViewRef"
                :peer-id="userId"
                class="flex-1 min-h-0"
                @select-reply="onSelectReply" />

            <!-- Bottom input area -->
            <div class="shrink-0 flex flex-col bg-card border-t border-border/30">
                <!-- Reply preview bar -->
                <Transition
                    enter-active-class="transition-all duration-150 ease-out"
                    leave-active-class="transition-all duration-100 ease-in"
                    enter-from-class="opacity-0 -translate-y-1"
                    leave-to-class="opacity-0 -translate-y-1"
                >
                    <div
                        v-if="replyTo"
                        class="flex items-center gap-3 px-5 pt-3 pb-0 overflow-hidden"
                    >
                        <div
                            class="w-[3px] self-stretch rounded-full shrink-0"
                            :style="{ backgroundColor: replyColor }"
                        />
                        <div class="flex flex-col gap-0.5 min-w-0 flex-1 overflow-hidden">
                            <div class="flex items-center gap-1.5">
                                <ReplyIcon class="w-3 h-3 text-muted-foreground/60 shrink-0" />
                                <span
                                    class="text-xs font-semibold leading-none truncate"
                                    :style="{ color: replyColor }"
                                >
                                    {{ replySenderName }}
                                </span>
                            </div>
                            <span class="text-xs text-muted-foreground/70 truncate leading-snug">
                                {{ replyTo.text || t('attachment') || 'Attachment' }}
                            </span>
                        </div>
                        <button
                            class="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
                            @click="clearReply"
                        >
                            <XIcon class="w-3.5 h-3.5" />
                        </button>
                    </div>
                </Transition>

                <div class="px-5 py-4">
                    <ChatInput
                        v-if="userId"
                        ref="chatInputRef"
                        :receiver-id="userId"
                        :reply-to="replyTo"
                        @clear-reply="clearReply"
                        @add-optimistic="onAddOptimistic"
                        @resolve-optimistic="onResolveOptimistic"
                        @mark-optimistic-failed="onMarkFailed"
                    />
                </div>
            </div>
        </div>

        <!-- ═══ IN CALL: horizontal layout — call main + chat sidebar ═══ -->
        <div v-else class="flex flex-row flex-1 min-h-0 overflow-hidden">
            <!-- Call area (fills remaining space) -->
            <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
                <ChatPanel class="flex-1 min-h-0" @end="endCall" />
            </div>

            <!-- Chat sidebar -->
            <Transition name="chat-sidebar">
                <div
                    v-if="chatSidebarOpen"
                    class="chat-sidebar flex flex-col border-l border-border/50 bg-card"
                >
                    <DmChatView
                        v-if="userId"
                        ref="chatViewRef"
                        :peer-id="userId"
                        class="flex-1 min-h-0"
                        @select-reply="onSelectReply" />

                    <!-- Sidebar input area -->
                    <div class="shrink-0 flex flex-col border-t border-border/30">
                        <Transition
                            enter-active-class="transition-all duration-150 ease-out"
                            leave-active-class="transition-all duration-100 ease-in"
                            enter-from-class="opacity-0 -translate-y-1"
                            leave-to-class="opacity-0 -translate-y-1"
                        >
                            <div
                                v-if="replyTo"
                                class="flex items-center gap-3 px-3 pt-2 pb-0 overflow-hidden"
                            >
                                <div
                                    class="w-[3px] self-stretch rounded-full shrink-0"
                                    :style="{ backgroundColor: replyColor }"
                                />
                                <div class="flex flex-col gap-0.5 min-w-0 flex-1 overflow-hidden">
                                    <div class="flex items-center gap-1.5">
                                        <ReplyIcon class="w-3 h-3 text-muted-foreground/60 shrink-0" />
                                        <span
                                            class="text-xs font-semibold leading-none truncate"
                                            :style="{ color: replyColor }"
                                        >
                                            {{ replySenderName }}
                                        </span>
                                    </div>
                                    <span class="text-xs text-muted-foreground/70 truncate leading-snug">
                                        {{ replyTo.text || t('attachment') || 'Attachment' }}
                                    </span>
                                </div>
                                <button
                                    class="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
                                    @click="clearReply"
                                >
                                    <XIcon class="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </Transition>

                        <div class="px-3 py-3">
                            <ChatInput
                                v-if="userId"
                                ref="chatInputRef"
                                :receiver-id="userId"
                                :reply-to="replyTo"
                                @clear-reply="clearReply"
                                @add-optimistic="onAddOptimistic"
                                @resolve-optimistic="onResolveOptimistic"
                                @mark-optimistic-failed="onMarkFailed"
                            />
                        </div>
                    </div>
                </div>
            </Transition>
        </div>
    </div>
</template>

<style scoped>
.chat-sidebar {
    width: 380px;
    min-width: 320px;
    max-width: 420px;
}

/* Sidebar slide transition */
.chat-sidebar-enter-active {
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.chat-sidebar-leave-active {
    transition: all 0.2s ease-in;
}
.chat-sidebar-enter-from,
.chat-sidebar-leave-to {
    width: 0;
    min-width: 0;
    opacity: 0;
    overflow: hidden;
}
</style>
