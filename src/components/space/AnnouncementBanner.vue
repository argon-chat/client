<template>
  <Transition name="announcement-banner">
    <section
      v-if="visible && message && channel"
      class="announcement-banner"
      data-testid="announcement-banner"
      :aria-label="t('announcement_banner_title')"
    >
      <header class="banner-head">
        <AntennaIcon class="banner-icon" aria-hidden="true" />
        <span class="banner-channel" :title="channel.name">{{ channel.name }}</span>
        <time class="banner-time" :datetime="sentAt.toISOString()">{{ time }}</time>
      </header>

      <div class="banner-author">
        <ArgonAvatar :user-id="message.sender" :overrided-size="16" class="shrink-0 rounded-full" />
        <span class="truncate" data-testid="announcement-author">{{ authorName }}</span>
      </div>

      <p class="banner-text" data-testid="announcement-text">{{ text }}</p>

      <div class="banner-actions">
        <Button size="xs" data-action="open" @click="onOpen">{{ t("announcement_banner_open") }}</Button>
        <Button size="xs" variant="ghost" data-action="dismiss" @click="dismiss">{{ t("announcement_banner_dismiss") }}</Button>
      </div>
    </section>
  </Transition>
</template>

<script setup lang="ts">
import { computed, toRef } from "vue";
import { AntennaIcon } from "lucide-vue-next";
import { Button } from "@argon/ui/button";
import type { Guid } from "@argon-chat/ion.webcore";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useLocale } from "@/store/system/localeStore";
import { useAnnouncementBanner } from "@/composables/useAnnouncementBanner";
import { bannerTime, previewText } from "@/lib/announcements/spaceAnnouncements";

const props = defineProps<{
  spaceId: Guid | null;
  /** The channel open in the primary pane; the banner stays out of the way while that is the one. */
  openChannelId: Guid | null;
}>();

const emit = defineEmits<{ open: [channelId: Guid] }>();

const { t } = useLocale();
const { channel, message, author, visible, dismiss, open } = useAnnouncementBanner(
  toRef(props, "spaceId"),
  toRef(props, "openChannelId"),
);

const sentAt = computed(() => message.value?.timeSent.toDate() ?? new Date(0));
const time = computed(() => bannerTime(sentAt.value));
const authorName = computed(() => author.value?.displayName || t("unknown_display_name"));
const text = computed(() => previewText(message.value?.text ?? "") || t("attachment"));

function onOpen() {
  const id = open();
  if (id) emit("open", id);
}
</script>

<style scoped>
.announcement-banner {
  position: relative;
  margin: 8px 8px 4px;
  padding: 10px 10px 8px 12px;
  border-radius: calc(var(--radius) - 2px);
  border: 1px solid hsl(var(--primary) / 0.35);
  background: hsl(var(--primary) / 0.07);
  overflow: hidden;
}

/* Accent edge: reads as "from the space", not as another chat bubble. */
.announcement-banner::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: hsl(var(--primary));
}

.banner-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
}

.banner-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: hsl(var(--primary));
}

.banner-channel {
  font-weight: 600;
  color: hsl(var(--foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.banner-time {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}

.banner-author {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}

.banner-text {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.35;
  color: hsl(var(--foreground));
  white-space: pre-line;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.banner-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 8px;
}

.announcement-banner-enter-active,
.announcement-banner-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.announcement-banner-enter-from,
.announcement-banner-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .announcement-banner-enter-active,
  .announcement-banner-leave-active {
    transition: none;
  }
}
</style>
