<template>
    <div class="channel-chat flex flex-col h-full overflow-hidden relative">
        <div v-if="channelData && selectedChannelId && selectedSpaceId" ref="messageContainer"
            class="messages-scroll flex-1">
            <ChatView :channel-id="selectedChannelId" :space-id="selectedSpaceId" :channel-name="channelData.name" :typing-users="typingUsers" @select-reply="onReplySelect" />
        </div>

        <div v-if="!channelData" class="empty-state">
            <div class="empty-state-inner">
                <div class="empty-state-icon">
                    <RadioIcon class="h-8 w-8" />
                </div>
                <h3 class="empty-state-title">
                    {{ t("no_text_channel_found") }}
                </h3>
                <p class="empty-state-desc">
                    {{ t("you_not_access_to_channel_or_not_found_channels") }}
                </p>
            </div>
        </div>

        <div v-if="channelData" class="message-input-area">
            <EnterText :reply-to="replyTo" :space-id="selectedSpaceId!" @clear-reply="replyTo = null" @typing="onTyping"
                @stop_typing="onStopTyping" />
        </div>
    </div>
</template>
<script setup lang="ts">
import { RadioIcon } from "lucide-vue-next";
import { ref } from "vue";
import { useLocale } from "@/store/localeStore";
import EnterText from "./chats/EnterText.vue";
import ChatView from "./ChatView.vue";
import { useChannelData } from "@/composables/useChannelData";
import { useChannelTyping } from "@/composables/useChannelTyping";
import { ArgonMessage } from "@argon/glue";

const { t } = useLocale();

const replyTo = ref<ArgonMessage | null>(null);

function onReplySelect(message: ArgonMessage) {
    replyTo.value = message;
}

const selectedSpaceId = defineModel<string | null>('selectedSpace', {
    type: String, required: true
});

const selectedChannelId = defineModel<string | null>('selectedChannelId', {
    type: String, required: true
});

const { channelData } = useChannelData(selectedChannelId);
const { typingUsers, onTyping, onStopTyping } = useChannelTyping(selectedChannelId, channelData);
</script>

<style scoped>
.channel-chat {
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 15px;
    background: hsl(var(--card));
}

.messages-scroll {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
}

/* Empty state */
.empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
}

.empty-state-inner {
    max-width: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
}

.empty-state-icon {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: hsl(var(--muted) / 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    color: hsl(var(--muted-foreground));
    margin-bottom: 1rem;
}

.empty-state-title {
    font-size: 1rem;
    font-weight: 600;
    color: hsl(var(--foreground));
    margin-bottom: 0.375rem;
}

.empty-state-desc {
    font-size: 0.82rem;
    color: hsl(var(--muted-foreground));
    line-height: 1.45;
}

/* Input area */
.message-input-area {
    background: hsl(var(--card));
    border-radius: 0 0 15px 15px;
    padding: 1.25rem;
    flex-shrink: 0;
    border-top: 1px solid hsl(var(--border) / 0.3);
}
</style>
