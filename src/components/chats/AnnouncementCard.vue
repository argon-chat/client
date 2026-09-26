<template>
  <article class="announcement-card" data-testid="announcement-card">
    <!-- Cover: the first image, full width above the text -->
    <div
      v-if="media.cover"
      class="announcement-cover"
      :style="{ aspectRatio: coverRatio }"
      data-testid="announcement-cover"
      @click="openImage(0)"
    >
      <AttachmentImage
        :file-id="media.cover.fileId"
        :file-name="media.cover.fileName"
        :width="media.cover.width"
        :height="media.cover.height"
        :thumb-hash="media.cover.thumbHash"
        :download-url="media.cover.downloadUrl"
      />
    </div>

    <div class="px-4 pt-3 pb-3.5 flex flex-col gap-2.5">
      <!-- Header: the space (post as space) or the author, with the date line -->
      <header class="flex items-center gap-2.5 min-w-0" data-testid="announcement-header">
        <Popover v-if="!header.asSpace" v-model:open="profileOpen">
          <PopoverTrigger>
            <ArgonAvatar
              :file-id="header.avatarFileId"
              :fallback="header.title"
              :user-id="author.userId"
              :overrided-size="36"
              class="w-9 h-9 rounded-full cursor-pointer"
            />
          </PopoverTrigger>
          <PopoverContent style="width: 24rem" class="p-0 rounded-2xl shadow-xl border border-border bg-popover text-popover-foreground overflow-hidden">
            <UserProfilePopover :user-id="author.userId" @close:pressed="profileOpen = false" @report="onReportProfile" />
          </PopoverContent>
        </Popover>
        <ArgonAvatar
          v-else
          :file-id="header.avatarFileId"
          :fallback="header.title"
          :overrided-size="36"
          class="w-9 h-9 rounded-xl"
        />

        <div class="flex flex-col min-w-0">
          <span
            class="text-sm font-semibold leading-tight truncate"
            :style="header.asSpace ? undefined : { color: authorColor }"
            data-testid="announcement-title"
          >{{ header.title }}</span>
          <span class="text-xs font-medium text-muted-foreground leading-tight mt-0.5 truncate">
            <time :datetime="isoTime" :title="isoTime">{{ dateLine }}</time>
            <template v-if="header.byline">
              <span class="mx-1">·</span>
              <Popover v-model:open="bylineOpen">
                <PopoverTrigger as-child>
                  <button type="button" class="hover:underline" data-testid="announcement-byline">
                    {{ t("announcement_by_author", { name: header.byline }) }}
                  </button>
                </PopoverTrigger>
                <PopoverContent style="width: 24rem" class="p-0 rounded-2xl shadow-xl border border-border bg-popover text-popover-foreground overflow-hidden">
                  <UserProfilePopover :user-id="author.userId" @close:pressed="bylineOpen = false" @report="onReportProfile" />
                </PopoverContent>
              </Popover>
            </template>
          </span>
        </div>
      </header>

      <slot name="reply" />

      <!-- Body -->
      <div v-if="fragments.length" class="relative">
        <div
          class="announcement-body"
          :class="{ 'announcement-body--collapsed': collapsed }"
          data-testid="announcement-body"
        >
          <ChatSegment
            v-for="(seg, i) in fragments"
            :key="i"
            :entity="seg.entity"
            :text="seg.text"
            @unsupported="emit('unsupported')"
          />
          <span v-if="edited" class="ml-1 text-[11px] text-muted-foreground/60 select-none whitespace-nowrap" :title="editedTitle">
            {{ t("message_edited") }}
          </span>
          <PublishedMark v-if="message.publishedAt" :at="message.publishedAt" />
        </div>
        <button
          v-if="collapsible"
          type="button"
          class="mt-1 text-sm font-medium text-primary hover:underline"
          data-testid="announcement-read-more"
          @click="expanded = !expanded"
        >
          {{ expanded ? t("announcement_show_less") : t("announcement_read_more") }}
        </button>
      </div>

      <!-- The other images, the way chat renders them -->
      <AttachmentImageGrid v-if="media.images.length" :images="media.images" @open-lightbox="(i: number) => openImage(i + 1)" />

      <img
        v-for="(gif, gi) in gifs"
        :key="`gif-${gi}`"
        :src="gif.previewUrl ?? undefined"
        :alt="gif.gifId || 'GIF'"
        class="rounded-lg max-w-full"
        :style="{ width: Math.min(gif.width || 320, 420) + 'px' }"
      />

      <LinkPreviewCard v-if="linkPreview" :preview="linkPreview" :accent="authorColor" />

      <AttachmentFileCard
        v-for="(f, i) in media.files"
        :key="i"
        :file-id="f.fileId"
        :file-name="f.fileName"
        :file-size="f.fileSize"
        :content-type="f.contentType"
      />
    </div>
  </article>
</template>

<script setup lang="ts">
import PublishedMark from "./PublishedMark.vue";
/**
 * An announcement post as a card: no grouping, the date up front, the first image as a cover and
 * long text behind "Read more". With "post as space" the space heads the card instead of the
 * author; the message still carries its real sender, so reports and moderation are unaffected.
 * MessageItem keeps everything around it (actions, context menu, reactions).
 */
import { computed, ref } from "vue";
import { EntityType, type ArgonMessage, type MessageEntityAttachment, type MessageEntityGif, type MessageEntityLinkPreview } from "@argon/glue";
import { Popover, PopoverContent, PopoverTrigger } from "@argon/ui/popover";
import { useLocale } from "@/store/system/localeStore";
import { fragmentMessageText } from "@/composables/useMessageContent";
import { showLinkPreviews } from "@/lib/linkPreview/settings";
import { cardHeader, cardMedia, formatCardDate, shouldCollapse } from "@/lib/chat/announcement";
import type { AnnouncementCardContext } from "@/composables/useAnnouncementChannel";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import UserProfilePopover from "@/components/popovers/UserProfilePopover.vue";
import ChatSegment from "./ChatSegment.vue";
import AttachmentImage from "./AttachmentImage.vue";
import AttachmentImageGrid from "./AttachmentImageGrid.vue";
import AttachmentFileCard from "./AttachmentFileCard.vue";
import LinkPreviewCard from "./LinkPreviewCard.vue";

const props = defineProps<{
  message: ArgonMessage;
  context: AnnouncementCardContext;
  author: { userId: string; displayName?: string | null; avatarFileId?: string | null };
  authorColor?: string;
}>();

const emit = defineEmits<{
  (e: "open-lightbox", images: MessageEntityAttachment[], index: number, timeSent: Date | null): void;
  (e: "unsupported"): void;
  (e: "report-profile", userId: string): void;
}>();

const { t } = useLocale();

const profileOpen = ref(false);
const bylineOpen = ref(false);

const header = computed(() =>
  cardHeader(
    props.context.settings,
    { name: props.author.displayName || t("unknown_display_name"), avatarFileId: props.author.avatarFileId ?? null },
    props.context.space,
  ),
);

const fragments = computed(() => fragmentMessageText(props.message.text, props.message.entities));

const collapsible = computed(() => shouldCollapse(props.message.text));
const expanded = ref(false);
const collapsed = computed(() => collapsible.value && !expanded.value);

const media = computed(() => cardMedia(props.message.entities));
const allImages = computed(() => (media.value.cover ? [media.value.cover, ...media.value.images] : media.value.images));

const coverRatio = computed(() => {
  const c = media.value.cover;
  const w = c?.width || 16;
  const h = c?.height || 9;
  // Very tall covers would push the text off screen; very wide ones are cropped less.
  return String(Math.min(3, Math.max(4 / 5, w / h)));
});

const gifs = computed(() => (props.message.entities ?? []).filter((e): e is MessageEntityGif => e.type === EntityType.Gif));

const linkPreview = computed<MessageEntityLinkPreview | null>(() => {
  if (!showLinkPreviews.value) return null;
  const entity = (props.message.entities ?? []).find(
    (e): e is MessageEntityLinkPreview => e.type === EntityType.LinkPreview,
  );
  return entity && (entity.title || entity.description || entity.imageUrl) ? entity : null;
});

const sent = computed(() => props.message.timeSent.toDate());
const isoTime = computed(() => sent.value.toISOString());
const dateLine = computed(() => {
  const hour12 = typeof document !== "undefined" && document.documentElement.getAttribute("data-timestamp-format") === "12h";
  const lang = typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined;
  return formatCardDate(sent.value, hour12, lang);
});

const edited = computed(() => !!props.message.editedAt);
const editedTitle = computed(() => {
  const at = props.message.editedAt?.toDate();
  return at ? `${t("message_edited_at")} ${at.toLocaleString()}` : "";
});

function openImage(index: number) {
  emit("open-lightbox", allImages.value, index, sent.value);
}

function onReportProfile(userId: string) {
  profileOpen.value = false;
  bylineOpen.value = false;
  emit("report-profile", userId);
}
</script>

<style scoped>
.announcement-card {
  width: 100%;
  border-radius: var(--chat-bubble-radius, 1rem);
  border: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--muted) / 0.55);
  overflow: hidden;
}

.announcement-cover {
  width: 100%;
  max-height: 420px;
  overflow: hidden;
  cursor: pointer;
  background: hsl(var(--muted));
}

.announcement-cover :deep(.attachment-image) {
  width: 100%;
  height: 100%;
  border-radius: 0;
  min-height: 0;
}

.announcement-cover :deep(.actual-image) {
  object-fit: cover;
}

.announcement-body {
  font-size: 0.95rem;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: hsl(var(--foreground));
}

/* About twelve lines, fading out into "Read more". */
.announcement-body--collapsed {
  max-height: 19.2em;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent);
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}
</style>
