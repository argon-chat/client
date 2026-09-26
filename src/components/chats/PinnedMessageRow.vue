<template>
  <div class="group/pin flex gap-2.5 px-3 py-2.5 rounded-lg transition-colors hover:bg-accent/50" data-testid="pinned-message-row">
    <ArgonAvatar
      :file-id="user?.avatarFileId ?? null"
      :fallback="displayName"
      :user-id="message.sender"
      :overrided-size="28"
      class="w-7 h-7 rounded-full shrink-0 mt-0.5"
    />

    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
      <div class="flex items-baseline gap-1.5 min-w-0">
        <span class="text-[13px] font-semibold leading-tight truncate" :style="{ color }">{{ displayName }}</span>
        <span class="text-[11px] text-muted-foreground/60 tabular-nums whitespace-nowrap shrink-0">{{ sentAt }}</span>
      </div>

      <p v-if="preview" class="text-sm text-foreground/85 leading-snug line-clamp-3 break-words whitespace-pre-wrap">
        {{ preview }}
      </p>

      <span
        v-if="attachmentCount"
        class="inline-flex items-center gap-1 text-xs text-muted-foreground"
        data-testid="pinned-attachment-hint"
      >
        <PaperclipIcon class="w-3 h-3" />
        {{ t('pins_attachments', { count: attachmentCount }) }}
      </span>

      <div class="flex items-center gap-1 mt-1">
        <button
          class="inline-flex items-center gap-1 h-6 px-2 rounded-md text-xs font-medium text-primary bg-primary/10 hover:bg-primary/15 transition-colors"
          data-testid="pinned-jump"
          @click="emit('jump', message.messageId)"
        >
          <CornerDownRightIcon class="w-3 h-3" />
          {{ t('pins_jump') }}
        </button>
        <button
          v-if="canManage"
          class="inline-flex items-center gap-1 h-6 px-2 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          data-testid="pinned-unpin"
          @click="emit('unpin', message.messageId)"
        >
          <PinOffIcon class="w-3 h-3" />
          {{ t('pins_unpin_short') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { CornerDownRightIcon, PaperclipIcon, PinOffIcon } from "lucide-vue-next";
import { EntityType, type PinnedMessage } from "@argon/glue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { usePoolStore } from "@/store/data/poolStore";
import { useUserColors } from "@/store/chat/userColors";
import { useLocale } from "@/store/system/localeStore";

const props = defineProps<{ pin: PinnedMessage; canManage: boolean }>();

const emit = defineEmits<{
  (e: "jump", messageId: bigint): void;
  (e: "unpin", messageId: bigint): void;
}>();

const { t } = useLocale();
const pool = usePoolStore();
const userColors = useUserColors();

const message = computed(() => props.pin.message);
const user = pool.getUserReactive(computed(() => props.pin.message.sender));
const displayName = computed(() => user.value?.displayName || t("unknown_display_name"));
const color = computed(() => userColors.getColorByUserId(props.pin.message.sender ?? ""));

const sentAt = computed(() =>
  props.pin.message.timeSent.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
);

const preview = computed(() => props.pin.message.text?.trim() ?? "");

const attachmentCount = computed(
  () => (props.pin.message.entities ?? []).filter((e) => e.type === EntityType.Attachment || e.type === EntityType.Gif).length,
);
</script>
