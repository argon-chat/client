<template>
  <div class="space-y-6">
    <section
      v-for="section in sections"
      :key="section.kind"
      class="setting-card space-y-4"
      :data-testid="`follows-${section.kind}`"
    >
      <div class="flex items-start gap-2 min-w-0">
        <component :is="section.icon" class="w-5 h-5 mt-0.5 shrink-0" />
        <div class="min-w-0">
          <h3 class="text-lg font-semibold leading-tight">{{ t(section.title) }}</h3>
          <p class="text-xs text-muted-foreground mt-1">{{ t(section.desc) }}</p>
        </div>
      </div>

      <div v-if="section.state.loading" class="flex justify-center py-4">
        <Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
      </div>

      <div
        v-else-if="section.state.failed"
        class="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5"
        data-testid="follows-error"
      >
        <span class="text-sm text-muted-foreground">{{ t("follows_load_failed") }}</span>
        <Button size="sm" variant="outline" @click="load(section.kind)">{{ t("try_again") }}</Button>
      </div>

      <p v-else-if="!section.rows.length" class="text-sm text-muted-foreground px-1" data-testid="follows-empty">
        {{ t(section.empty) }}
      </p>

      <ul v-else class="follow-list">
        <li v-for="row in section.rows" :key="row.followId" class="follow-row" :data-follow="row.followId">
          <ArgonAvatar
            :file-id="row.avatarFileId"
            :fallback="row.spaceName"
            :space-id="row.spaceId"
            :overrided-size="32"
            class="w-8 h-8 rounded-lg shrink-0"
          />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium truncate">{{ row.spaceName }}</div>
            <div class="text-xs text-muted-foreground truncate">#{{ row.channelName }}</div>
          </div>
          <Button
            size="sm"
            variant="outline"
            class="shrink-0"
            :disabled="removing.has(row.followId)"
            data-testid="follow-remove"
            @click="remove(row.followId)"
          >
            <Loader2 v-if="removing.has(row.followId)" class="w-4 h-4 mr-2 animate-spin" />
            {{ t(section.action) }}
          </Button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * The "Follows" tab of the channel settings. An announcement channel lists the channels that follow
 * it; any text or announcement channel lists the announcement channels it follows. Either side can
 * end a follow from here.
 */
import { computed, onMounted, reactive, watch } from "vue";
import { Loader2, RssIcon, UsersIcon } from "lucide-vue-next";
import { ChannelType, type ArgonChannel, type ChannelFollowLink } from "@argon/glue";
import { Button } from "@argon/ui/button";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useLocale } from "@/store/system/localeStore";
import { useChannelFollow } from "@/composables/useChannelFollow";

const props = defineProps<{ channel: ArgonChannel }>();

const { t } = useLocale();
const { toast } = useToast();
const { followers, followedSources, removeFollow } = useChannelFollow();

type Kind = "followers" | "following";

interface ListState {
  loading: boolean;
  failed: boolean;
  links: ChannelFollowLink[];
}

const state = reactive<Record<Kind, ListState>>({
  followers: { loading: false, failed: false, links: [] },
  following: { loading: false, failed: false, links: [] },
});
const removing = reactive(new Set<string>());

const isAnnouncement = computed(() => props.channel.type === ChannelType.Announcement);

// Followers show where posts go (the target), followed channels where they come from (the source).
const sections = computed(() => {
  const list = [];
  if (isAnnouncement.value) {
    list.push({
      kind: "followers" as const,
      icon: UsersIcon,
      title: "channel_followers",
      desc: "channel_followers_desc",
      empty: "channel_followers_empty",
      action: "remove",
      state: state.followers,
      rows: state.followers.links.map((l) => ({
        followId: l.followId,
        spaceId: l.targetSpaceId,
        spaceName: l.targetSpaceName,
        channelName: l.targetChannelName,
        avatarFileId: l.targetSpaceAvatarFileId,
      })),
    });
  }
  list.push({
    kind: "following" as const,
    icon: RssIcon,
    title: "channel_following",
    desc: "channel_following_desc",
    empty: "channel_following_empty",
    action: "follow_unfollow",
    state: state.following,
    rows: state.following.links.map((l) => ({
      followId: l.followId,
      spaceId: l.sourceSpaceId,
      spaceName: l.sourceSpaceName,
      channelName: l.sourceChannelName,
      avatarFileId: l.sourceSpaceAvatarFileId,
    })),
  });
  return list;
});

async function load(kind: Kind) {
  const target = state[kind];
  const { spaceId, channelId } = props.channel;
  target.loading = true;
  target.failed = false;
  try {
    target.links =
      kind === "followers" ? await followers(spaceId, channelId) : await followedSources(spaceId, channelId);
  } catch (e) {
    logger.error(`[ChannelFollows] loading ${kind} failed`, e);
    target.failed = true;
  } finally {
    target.loading = false;
  }
}

async function remove(followId: string) {
  if (removing.has(followId)) return;
  removing.add(followId);
  try {
    const outcome = await removeFollow(props.channel.spaceId, props.channel.channelId, followId);
    if (outcome.ok) {
      state.followers.links = state.followers.links.filter((l) => l.followId !== followId);
      state.following.links = state.following.links.filter((l) => l.followId !== followId);
    } else {
      toast({ title: t("follow_remove_failed"), description: t(outcome.errorKey), variant: "destructive" });
    }
  } finally {
    removing.delete(followId);
  }
}

onMounted(() => void load("following"));
// A text channel converted to an announcement channel while open gains its followers list.
watch(isAnnouncement, (on) => {
  if (on) void load("followers");
}, { immediate: true });
</script>

<style scoped>
.setting-card {
  border-radius: 0.75rem;
  border: 1px solid hsl(var(--border) / 0.5);
  background-color: hsl(var(--card) / var(--card-alpha));
  padding: 1.5rem;
  overflow: hidden;
}

.follow-list {
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 0.5rem;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
}

.follow-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: calc(var(--radius) - 4px);
}

.follow-row:hover {
  background-color: hsl(var(--foreground) / 0.04);
}
</style>
