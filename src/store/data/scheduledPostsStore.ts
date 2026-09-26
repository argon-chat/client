import { logger } from "@argon/core";
import {
  SchedulePostError,
  ScheduledPostFailure,
  ScheduledPostStatus,
  type IMessageEntity,
  type ISchedulePostResult,
  type ScheduledPost,
  type ScheduledPostUpdated,
} from "@argon/glue";
import { IonDateTime } from "@argon-chat/ion.webcore";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useApi } from "@/store/system/apiStore";
import { metrics } from "@/lib/telemetry/metrics";
import { useBus } from "@/store/realtime/busStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { useLocale } from "@/store/system/localeStore";
import { useToast } from "@argon/ui/toast";

/** Pending and failed posts are the ones a list shows; published and cancelled ones drop out. */
export const isListed = (post: ScheduledPost) =>
  post.status === ScheduledPostStatus.PENDING || post.status === ScheduledPostStatus.FAILED;

export const FAILURE_KEYS: Partial<Record<ScheduledPostFailure, string>> = {
  [ScheduledPostFailure.CHANNEL_NOT_FOUND]: "scheduled_failure_channel",
  [ScheduledPostFailure.INSUFFICIENT_PERMISSIONS]: "scheduled_failure_permissions",
  [ScheduledPostFailure.SLOW_MODE]: "scheduled_failure_slow_mode",
  [ScheduledPostFailure.SEND_FAILED]: "scheduled_failure_send",
};

export const failureKey = (failure: ScheduledPostFailure) => FAILURE_KEYS[failure] ?? "scheduled_failure_send";

const byTime = (a: ScheduledPost, b: ScheduledPost) =>
  a.publishAt.unixTicks < b.publishAt.unixTicks ? -1 : a.publishAt.unixTicks > b.publishAt.unixTicks ? 1 : 0;

/**
 * Scheduled posts per channel, as GetScheduledPosts returns them: the user's own pending and failed
 * posts, plus everybody's pending ones for ManageMessages. Kept current by the user's own calls and
 * by ScheduledPostUpdated, which the server sends the author when a post publishes or fails.
 */
export const useScheduledPostsStore = defineStore("scheduledPosts", () => {
  const api = useApi();
  const bus = useBus();

  /** Channel id → listed posts, oldest first. A channel never loaded has no entry. */
  const byChannel = ref<Record<string, ScheduledPost[]>>({});
  const loaded = new Set<string>();

  let subscribed = false;
  /** Once per app: the author hears about their posts wherever they are. */
  function ensureSubscribed() {
    if (subscribed) return;
    subscribed = true;
    bus.onServerEvent<ScheduledPostUpdated>("ScheduledPostUpdated", (e) => {
      notify(e.post);
      apply(e.post);
    });
  }

  function notify(post: ScheduledPost) {
    const { t } = useLocale();
    const { toast } = useToast();
    if (post.status === ScheduledPostStatus.PUBLISHED) toast({ title: t("scheduled_published") });
    else if (post.status === ScheduledPostStatus.FAILED)
      toast({ title: t("scheduled_failed"), description: t(failureKey(post.failure)), variant: "destructive" });
  }

  onSessionReset(() => {
    byChannel.value = {};
    loaded.clear();
  });

  /** Puts a post's latest state into its channel's list, if that list is loaded (or `force`). */
  function apply(post: ScheduledPost, force = false) {
    const current = byChannel.value[post.channelId];
    if (!current && !force) return;
    const rest = (current ?? []).filter((p) => p.postId !== post.postId);
    byChannel.value = {
      ...byChannel.value,
      [post.channelId]: isListed(post) ? [...rest, post].sort(byTime) : rest,
    };
  }

  function postsOf(channelId: string | null | undefined): ScheduledPost[] {
    return channelId ? byChannel.value[channelId] ?? [] : [];
  }

  async function load(spaceId: string, channelId: string): Promise<void> {
    ensureSubscribed();
    try {
      const posts = await api.channelComposerInteraction.GetScheduledPosts(spaceId, channelId);
      byChannel.value = { ...byChannel.value, [channelId]: [...posts].filter(isListed).sort(byTime) };
      loaded.add(channelId);
    } catch (e) {
      logger.error("Failed to load scheduled posts", e);
    }
  }

  /** Once per channel and session: the author's own changes arrive as events after that. */
  async function ensureLoaded(spaceId: string, channelId: string): Promise<void> {
    if (!loaded.has(channelId)) await load(spaceId, channelId);
  }

  function countSchedule(action: "schedule" | "reschedule", result: ISchedulePostResult) {
    metrics.count("message.scheduled", result.isSuccessSchedulePost()
      ? { action, result: "ok" }
      : { action, result: "failed", error: metrics.enumName(SchedulePostError, result.isFailedSchedulePost() ? result.error : SchedulePostError.NONE) });
  }

  async function schedule(spaceId: string, channelId: string, text: string, entities: IMessageEntity[], at: Date): Promise<ISchedulePostResult> {
    ensureSubscribed();
    const result = await api.channelComposerInteraction.SchedulePost(spaceId, channelId, text, entities, IonDateTime.fromDate(at));
    if (result.isSuccessSchedulePost()) apply(result.post, true);
    countSchedule("schedule", result);
    return result;
  }

  async function reschedule(spaceId: string, channelId: string, postId: string, at: Date): Promise<ISchedulePostResult> {
    const result = await api.channelComposerInteraction.ReschedulePost(spaceId, channelId, postId, IonDateTime.fromDate(at));
    if (result.isSuccessSchedulePost()) apply(result.post, true);
    countSchedule("reschedule", result);
    return result;
  }

  async function cancel(spaceId: string, channelId: string, postId: string): Promise<boolean> {
    const done = await api.channelComposerInteraction.CancelScheduledPost(spaceId, channelId, postId);
    metrics.count("message.scheduled", { action: "cancel", result: done ? "ok" : "failed" });
    if (done) {
      const post = postsOf(channelId).find((p) => p.postId === postId);
      if (post) apply({ ...post, status: ScheduledPostStatus.CANCELLED });
    }
    return done;
  }

  return { byChannel, postsOf, load, ensureLoaded, schedule, reschedule, cancel, apply, listen: ensureSubscribed };
});
