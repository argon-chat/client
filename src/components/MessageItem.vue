<template>
    <div class="message-item" :class="{
        incoming: isIncoming,
        outgoing: !isIncoming
    }" v-if="user">

        <Popover v-model:open="isOpened">
            <PopoverContent style="width: 19rem;min-height: 25rem;"
                class="p-0 rounded-2xl shadow-xl border border-neutral-800 bg-[#09090b] text-white overflow-hidden">
                <UserProfilePopover :user-id="user!.userId" @close:pressed="isOpened = false" />
            </PopoverContent>
            <PopoverTrigger>
                <ArgonAvatar :file-id="user.avatarFileId" :fallback="user.displayName"
                    :serverId="message.spaceId" :userId="user.userId" class="avatar" />
            </PopoverTrigger>
        </Popover>

        <div class="message-content">
            <div class="meta">
                <span class="username" :data-user-id="user.userId"
                    :style="{ 'color': getColorByUserId(user.userId) }">{{ user?.displayName || t("unknown_display_name") }}</span>

                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            <span class="time">{{ formattedTime }}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>{{ formattedFullTime }}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <template v-if="!isRequiredUpperVersionMessage">
                <div class="bubble flex" style="flex-flow: column;" v-if="!isSingleEmojiMessage" :style="{
                    backgroundPositionY: backgroundOffset + 'px',
                }" ref="bubble">
                    <div v-if="replyMessage" style="display: inline-table;" :class="cn(
                        'reply-preview inline-table',
                        'group relative inline-flex h-11 items-center justify-center rounded-xl border-0 bg-[length:200%] px-8 py-2 font-medium text-primary-foreground')
                        ">
                        <div class="reply-username" :style="{ 'color': getColorByUserId(user.userId) }">{{
                            replyUser?.value?.displayName || t("unknown_display_name")}}</div>
                        <div class="reply-text">{{ replyMessage.text }}</div>
                    </div>
                    <div>
                        <ChatSegment v-for="(x, y) in renderedMessage" :key="y" :entity="x.entity" :text="x.text" @unsupported="isRequiredUpperVersionMessage = true"  />
                    </div>
                </div>
                <div v-if="isSingleEmojiMessage" class="flex" style="font-size: xxx-large; flex-flow: column;">
                    <div v-if="replyMessage" style="display: inline-table;" :class="cn(
                        'reply-preview inline-table',
                        'group relative inline-flex h-11 items-center justify-center rounded-xl border-0 bg-[length:200%] px-8 py-2 font-medium text-primary-foreground')
                        ">
                        <div class="reply-username" :style="{ 'color': getColorByUserId(user.userId) }">{{
                            replyUser?.value?.displayName || t("unknown_display_name") }}</div>
                        <div class="reply-text">{{ replyMessage.text }}</div>
                    </div>
                    <div>
                        <ChatSegment v-for="(x, y) in renderedMessage" :key="y" :entity="x.entity" :text="x.text" @unsupported="isRequiredUpperVersionMessage = true" />
                    </div>
                </div>
            </template>
            <template v-else>
                <div class="rounded-r-lg border-red-500 border-l-4 bg-gray-800/40 italic text-sm p-4">
                   {{t("not_supported_message_please_update")  }}
                </div>

            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, Ref } from "vue";
import { usePoolStore } from "@/store/poolStore";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useMe } from "@/store/meStore";
import emojiRegex from "emoji-regex";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDateFormat } from "@vueuse/core";
import { useUserColors } from "@/store/userColors";
import ChatSegment from "./chats/ChatSegment.vue";
import UserProfilePopover from "./popovers/UserProfilePopover.vue";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ArgonMessage, IMessageEntity } from "@/lib/glue/argonChat";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();
const isOpened = ref(false);

const props = defineProps<{
  message: ArgonMessage;
  getMsgById: (replyId: bigint | null) => ArgonMessage;
}>();

const isRequiredUpperVersionMessage = ref(false);
const bubble = ref<HTMLElement | null>(null);
const backgroundOffset = ref(0);
const pool = usePoolStore();
const user = pool.getUserReactive(ref(props.message.sender));
const me = useMe();
const userColors = useUserColors();

interface IFrag {
  entity?: IMessageEntity;
  text: string;
}

const isSingleEmojiMessage = isUpEmojisOnly(props.message);

const isIncoming = computed(() => props.message.sender !== me.me?.userId);

const renderedMessage = ref([] as IFrag[]);

function fragmentMessageText(
  text: string,
  entities: IMessageEntity[],
): IFrag[] {
  const fragments: IFrag[] = [];
  let cursor = 0;

  const sorted = [...entities].sort((a, b) => a.offset - b.offset);

  for (const entity of sorted) {
    const start = entity.offset;
    const end = entity.offset + entity.length;

    if (cursor < start) {
      fragments.push({
        text: text.slice(cursor, start),
      });
    }

    fragments.push({
      text: text.slice(start, end),
      entity,
    });

    cursor = end;
  }

  if (cursor < (text?.length ?? 0)) {
    fragments.push({
      text: text.slice(cursor),
    });
  }

  return fragments;
}
const replyMessage = computed(() => {
  if (!props.message.replyId) return null;
  return props.getMsgById(props.message.replyId);
});

const replyUser = computed(() => {
  if (!replyMessage.value) return null;
  return pool.getUserReactive(ref(replyMessage.value.sender));
});

const updateBackground = () => {
  if (!bubble.value) return;
  const rect = bubble.value.getBoundingClientRect();
  backgroundOffset.value = rect.top;
};

onMounted(async () => {
  renderedMessage.value = fragmentMessageText(
    props.message.text,
    props.message.entities,
  );
  updateBackground();
  window.addEventListener("scroll", updateBackground, { passive: true });
});

onBeforeUnmount(() => {
  window.removeEventListener("scroll", updateBackground);
});

const formattedTime = computed(() => {
  const date = props.message.timeSent.date;
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
});

const formattedFullTime = useDateFormat(
  props.message.timeSent.date,
  "YYYY-MM-DD HH:mm:ss",
);

function getColorByUserId(userId: string): string {
  return userColors.getColorByUserId(userId);
}

function isUpEmojisOnly(message: ArgonMessage): boolean {
  if (!message.text) return false;
  const text = message.text.trim();
  const regex = emojiRegex();
  const matches = [...text.matchAll(regex)];
  const emojisOnly = matches.map((m) => m[0]).join("");
  return matches.length >= 1 && matches.length <= 2 && emojisOnly === text;
}
</script>

<style scoped>
.message-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
}

.avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
}

.message-content {
    max-width: 60%;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.meta {
    display: flex;
    align-items: center;
    gap: 8px;
}

.meta .time {
    font-size: 12px;
    color: #888;
}

.meta .username {
    font-size: 13px;
    font-weight: 600;
    color: #bbb;
    margin-bottom: 2px;
}

.incoming {}

.outgoing {}

.bubble {
    padding: 10px;
    border-radius: 4px 18px 18px 18px;
    color: #e0e0e0;
    font-size: 14px;
    line-height: 1.4;
    word-break: break-word;
    white-space: pre-wrap;
    background-color: #222;
}

.reply-preview {
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 6px;
    color: #d0d0d0;
    background-color: #181818;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.reply-username {
    font-weight: 800;
    margin-bottom: 2px;
}
</style>
