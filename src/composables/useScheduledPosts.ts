import { computed, watch } from "vue";
import { logger } from "@argon/core";
import {
  SchedulePostError,
  ScheduledPostStatus,
  type ISchedulePostResult,
  type ScheduledPost,
} from "@argon/glue";
import { useToast } from "@argon/ui/toast";
import { useLocale } from "@/store/system/localeStore";
import { useMe } from "@/store/auth/meStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useScheduledPostsStore } from "@/store/data/scheduledPostsStore";
import type { ParsedMessage } from "@/lib/chat/parseMessageContent";

export { failureKey } from "@/store/data/scheduledPostsStore";

/**
 * Posts scheduled for later, as the composer and the "Scheduled" chip use them.
 *
 * The server takes a time between one minute and thirty days ahead. The composer asks for at least
 * two minutes, so the clock skew and the round trip never turn a valid pick into PUBLISH_TOO_SOON.
 */

export const MIN_LEAD_MS = 2 * 60_000;
export const MAX_LEAD_MS = 30 * 24 * 60 * 60_000 - 60_000;

export interface ScheduleTarget {
  spaceId: string;
  channelId: string;
}

export type SchedulePresetId = "in_1h" | "tomorrow_9";

export interface SchedulePreset {
  id: SchedulePresetId;
  at: Date;
}

/** "In an hour" and "tomorrow at 9:00", in the user's own time zone. */
export function schedulePresets(now: Date): SchedulePreset[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [
    { id: "in_1h", at: new Date(now.getTime() + 60 * 60_000) },
    { id: "tomorrow_9", at: tomorrow },
  ];
}

export type PublishTimeProblem = "invalid" | "too_soon" | "too_late";

export function checkPublishAt(at: Date | null, now: Date): PublishTimeProblem | null {
  if (!at || Number.isNaN(at.getTime())) return "invalid";
  const lead = at.getTime() - now.getTime();
  if (lead < MIN_LEAD_MS) return "too_soon";
  if (lead > MAX_LEAD_MS) return "too_late";
  return null;
}

/** A date input ("2026-09-27") and a time input ("18:30") as one local moment. */
export function combineDateTime(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const at = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), 0, 0);
  return Number.isNaN(at.getTime()) ? null : at;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The inverse of {@link combineDateTime}, for pre-filling the inputs. */
export function splitDateTime(at: Date): { date: string; time: string } {
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

export const SCHEDULE_ERROR_KEYS: Partial<Record<SchedulePostError, string>> = {
  [SchedulePostError.CHANNEL_NOT_FOUND]: "schedule_error_channel",
  [SchedulePostError.NOT_A_TEXT_CHANNEL]: "schedule_error_channel",
  [SchedulePostError.INSUFFICIENT_PERMISSIONS]: "schedule_error_permissions",
  [SchedulePostError.EMPTY_MESSAGE]: "schedule_error_empty",
  [SchedulePostError.MESSAGE_TOO_LONG]: "schedule_error_too_long",
  [SchedulePostError.TOO_MANY_ATTACHMENTS]: "schedule_error_too_many_files",
  [SchedulePostError.PUBLISH_TOO_SOON]: "schedule_error_too_soon",
  [SchedulePostError.PUBLISH_TOO_LATE]: "schedule_error_too_late",
  [SchedulePostError.TOO_MANY_SCHEDULED]: "schedule_error_limit",
  [SchedulePostError.POST_NOT_FOUND]: "schedule_error_gone",
  [SchedulePostError.NOT_AUTHOR]: "schedule_error_not_author",
  [SchedulePostError.NOT_PENDING]: "schedule_error_gone",
};

export const scheduleErrorKey = (error: SchedulePostError) => SCHEDULE_ERROR_KEYS[error] ?? "schedule_error_unknown";

export const PUBLISH_TIME_KEYS: Record<PublishTimeProblem, string> = {
  invalid: "schedule_error_invalid_time",
  too_soon: "schedule_error_too_soon",
  too_late: "schedule_error_too_late",
};

/** A post's text on one line, cut for a list row. Empty for a post that is only files. */
export function postPreview(post: Pick<ScheduledPost, "text">): string {
  const text = post.text.replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

/**
 * `load: false` for a caller that only schedules (the composer): the chip above it loads the list.
 */
export function useScheduledPosts(target: () => ScheduleTarget | null, options: { load?: boolean } = {}) {
  const store = useScheduledPostsStore();
  const me = useMe();
  const pex = usePexStore();
  const { t } = useLocale();
  const { toast } = useToast();

  const posts = computed(() => store.postsOf(target()?.channelId));
  const own = computed(() => posts.value.filter((p) => p.authorId === me.me?.userId));
  const pendingCount = computed(() => posts.value.filter((p) => p.status === ScheduledPostStatus.PENDING).length);
  const failedCount = computed(() => own.value.filter((p) => p.status === ScheduledPostStatus.FAILED).length);
  const canModerate = computed(() => {
    const at = target();
    return !!at && pex.hasIn(at.channelId, "ManageMessages", at.spaceId);
  });

  if (options.load !== false)
    watch(
      () => target()?.channelId,
      () => {
        const at = target();
        if (at) void store.ensureLoaded(at.spaceId, at.channelId);
      },
      { immediate: true },
    );

  function report(result: ISchedulePostResult): boolean {
    if (result.isSuccessSchedulePost()) return true;
    const error = result.isFailedSchedulePost() ? result.error : SchedulePostError.NONE;
    toast({ title: t("schedule_failed"), description: t(scheduleErrorKey(error)), variant: "destructive" });
    return false;
  }

  function refuseTime(at: Date): boolean {
    const problem = checkPublishAt(at, new Date());
    if (!problem) return false;
    toast({ title: t("schedule_failed"), description: t(PUBLISH_TIME_KEYS[problem]), variant: "destructive" });
    return true;
  }

  /** Schedules what the composer holds. True when the server took it and the composer may clear. */
  async function schedule(content: ParsedMessage, at: Date): Promise<boolean> {
    const where = target();
    if (!where || refuseTime(at)) return false;
    if (!content.text.trim() && content.entities.length === 0) return false;
    try {
      const ok = report(await store.schedule(where.spaceId, where.channelId, content.text, content.entities, at));
      if (ok) toast({ title: t("schedule_done"), description: at.toLocaleString() });
      return ok;
    } catch (e) {
      logger.error("Failed to schedule a post", e);
      toast({ title: t("schedule_failed"), description: t("schedule_error_unknown"), variant: "destructive" });
      return false;
    }
  }

  /** Moderators hear nothing about other people's posts, so the panel asks again when it opens. */
  async function refresh(): Promise<void> {
    const where = target();
    if (where) await store.load(where.spaceId, where.channelId);
  }

  async function reschedule(postId: string, at: Date): Promise<boolean> {
    const where = target();
    if (!where || refuseTime(at)) return false;
    try {
      return report(await store.reschedule(where.spaceId, where.channelId, postId, at));
    } catch (e) {
      logger.error("Failed to reschedule a post", e);
      toast({ title: t("schedule_failed"), description: t("schedule_error_unknown"), variant: "destructive" });
      return false;
    }
  }

  async function cancel(postId: string): Promise<boolean> {
    const where = target();
    if (!where) return false;
    try {
      const done = await store.cancel(where.spaceId, where.channelId, postId);
      if (!done) toast({ title: t("schedule_cancel_failed"), variant: "destructive" });
      return done;
    } catch (e) {
      logger.error("Failed to cancel a scheduled post", e);
      toast({ title: t("schedule_cancel_failed"), variant: "destructive" });
      return false;
    }
  }

  return { posts, own, pendingCount, failedCount, canModerate, schedule, reschedule, cancel, refresh };
}
