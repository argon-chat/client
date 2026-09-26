/**
 * Scheduling from the composer and the "Scheduled" list.
 *
 * The composer asks for at least two minutes ahead (the server takes one), so a pick that clock
 * skew or the round trip would push under the server's minute never leaves the client. What goes
 * out is the composer's parsed content; what comes back joins the channel's list, and the author
 * is told when a post publishes or fails wherever they are.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { IonDateTime } from "@argon-chat/ion.webcore";
import {
  EntityType,
  FailedSchedulePost,
  MessageEntityBold,
  SchedulePostError,
  ScheduledPostFailure,
  ScheduledPostStatus,
  SuccessSchedulePost,
  type ScheduledPost,
} from "@argon/glue";

const h = await vi.hoisted(async () => {
  const { vi } = await import("vitest");
  return {
    api: {
      GetScheduledPosts: vi.fn(async (..._: unknown[]): Promise<any[]> => []),
      SchedulePost: vi.fn(async (..._: unknown[]): Promise<any> => null),
      ReschedulePost: vi.fn(async (..._: unknown[]): Promise<any> => null),
      CancelScheduledPost: vi.fn(async (..._: unknown[]) => true),
    },
    handlers: new Map<string, (e: any) => void>(),
    toast: vi.fn(),
    granted: new Set<string>(),
  };
});

vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({ channelComposerInteraction: h.api }) }));
vi.mock("@/store/realtime/busStore", () => ({
  useBus: () => ({
    onServerEvent: (key: string, cb: (e: any) => void) => {
      h.handlers.set(key, cb);
      return { unsubscribe() {} };
    },
  }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({ hasIn: (_channelId: string, flag: string) => h.granted.has(flag) }),
}));

import {
  checkPublishAt,
  combineDateTime,
  scheduleErrorKey,
  schedulePresets,
  splitDateTime,
  useScheduledPosts,
} from "@/composables/useScheduledPosts";

const target = { spaceId: "s1", channelId: "c1" };
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);
const settle = () => new Promise((r) => setTimeout(r, 0));

function post(postId: string, minutes: number, extra: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    postId,
    spaceId: "s1",
    channelId: "c1",
    authorId: "me",
    text: `post ${postId}`,
    entities: [],
    publishAt: IonDateTime.fromDate(inMinutes(minutes)),
    createdAt: IonDateTime.now(),
    status: ScheduledPostStatus.PENDING,
    failure: ScheduledPostFailure.NONE,
    messageId: null,
    ...extra,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  h.handlers.clear();
  h.toast.mockClear();
  h.granted = new Set();
  for (const fn of Object.values(h.api)) fn.mockReset();
  h.api.GetScheduledPosts.mockResolvedValue([]);
  h.api.CancelScheduledPost.mockResolvedValue(true);
});

describe("presets and the time window", () => {
  test("an hour from now, and tomorrow at nine on the local clock", () => {
    const now = new Date(2026, 8, 26, 22, 15);
    const [hour, tomorrow] = schedulePresets(now);

    expect(hour.id).toBe("in_1h");
    expect(hour.at.getTime() - now.getTime()).toBe(60 * 60_000);
    expect(tomorrow.id).toBe("tomorrow_9");
    expect([tomorrow.at.getFullYear(), tomorrow.at.getMonth(), tomorrow.at.getDate(), tomorrow.at.getHours(), tomorrow.at.getMinutes()])
      .toEqual([2026, 8, 27, 9, 0]);
  });

  test("two minutes to thirty days ahead is what the composer offers", () => {
    const now = new Date();
    expect(checkPublishAt(new Date(now.getTime() + 30_000), now)).toBe("too_soon");
    expect(checkPublishAt(new Date(now.getTime() + 90_000), now)).toBe("too_soon");
    expect(checkPublishAt(new Date(now.getTime() + 5 * 60_000), now)).toBeNull();
    expect(checkPublishAt(new Date(now.getTime() + 29 * 24 * 60 * 60_000), now)).toBeNull();
    expect(checkPublishAt(new Date(now.getTime() + 31 * 24 * 60 * 60_000), now)).toBe("too_late");
    expect(checkPublishAt(null, now)).toBe("invalid");
    expect(checkPublishAt(new Date(Number.NaN), now)).toBe("invalid");
  });

  test("the date and time inputs are one local moment, both ways", () => {
    const at = combineDateTime("2026-09-27", "18:30")!;
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 8, 27, 18, 30]);
    expect(splitDateTime(at)).toEqual({ date: "2026-09-27", time: "18:30" });
    expect(combineDateTime("", "18:30")).toBeNull();
    expect(combineDateTime("2026-09-27", "6pm")).toBeNull();
  });

  test("every refusal has words, and an unknown one falls back", () => {
    expect(scheduleErrorKey(SchedulePostError.PUBLISH_TOO_SOON)).toBe("schedule_error_too_soon");
    expect(scheduleErrorKey(SchedulePostError.TOO_MANY_SCHEDULED)).toBe("schedule_error_limit");
    expect(scheduleErrorKey(SchedulePostError.NONE)).toBe("schedule_error_unknown");
  });
});

describe("scheduling from the composer", () => {
  test("a time too soon never reaches the server", async () => {
    const { schedule } = useScheduledPosts(() => target, { load: false });

    const ok = await schedule({ text: "hi", entities: [] }, new Date(Date.now() + 30_000));

    expect(ok).toBe(false);
    expect(h.api.SchedulePost).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "schedule_error_too_soon", variant: "destructive" }));
  });

  test("the parsed content goes out, and the post joins the channel's list", async () => {
    const bold = new MessageEntityBold(EntityType.Bold, 0, 5, 1);
    const at = inMinutes(60);
    h.api.SchedulePost.mockResolvedValue(new SuccessSchedulePost(post("p1", 60, { text: "hello", entities: [bold] })));

    const scheduled = useScheduledPosts(() => target, { load: false });
    const ok = await scheduled.schedule({ text: "hello", entities: [bold] }, at);

    expect(ok).toBe(true);
    const [spaceId, channelId, text, entities, publishAt] = h.api.SchedulePost.mock.calls[0] as [string, string, string, unknown[], IonDateTime];
    expect([spaceId, channelId, text, entities]).toEqual(["s1", "c1", "hello", [bold]]);
    expect(publishAt.toDate().getTime()).toBe(at.getTime());
    expect(scheduled.posts.value.map((p) => p.postId)).toEqual(["p1"]);
    expect(scheduled.pendingCount.value).toBe(1);
  });

  test("a refusal is reported and nothing joins the list", async () => {
    h.api.SchedulePost.mockResolvedValue(new FailedSchedulePost(SchedulePostError.TOO_MANY_SCHEDULED));

    const scheduled = useScheduledPosts(() => target, { load: false });
    const ok = await scheduled.schedule({ text: "hello", entities: [] }, inMinutes(60));

    expect(ok).toBe(false);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "schedule_error_limit" }));
    expect(scheduled.posts.value).toEqual([]);
  });

  test("the composer's instance leaves loading to the chip", () => {
    useScheduledPosts(() => target, { load: false });
    expect(h.api.GetScheduledPosts).not.toHaveBeenCalled();
  });
});

describe("the channel's list", () => {
  test("loads oldest first and counts pending and failed apart", async () => {
    h.api.GetScheduledPosts.mockResolvedValue([
      post("late", 120),
      post("failed", 5, { status: ScheduledPostStatus.FAILED, failure: ScheduledPostFailure.SLOW_MODE }),
      post("soon", 10),
    ]);

    const scheduled = useScheduledPosts(() => target);
    await settle();

    expect(h.api.GetScheduledPosts).toHaveBeenCalledWith("s1", "c1");
    expect(scheduled.posts.value.map((p) => p.postId)).toEqual(["failed", "soon", "late"]);
    expect(scheduled.pendingCount.value).toBe(2);
    expect(scheduled.failedCount.value).toBe(1);
  });

  test("a published post leaves the list and the author is told; a failed one stays with its reason", async () => {
    const p1 = post("p1", 10);
    h.api.GetScheduledPosts.mockResolvedValue([p1]);
    const scheduled = useScheduledPosts(() => target);
    await settle();

    h.handlers.get("ScheduledPostUpdated")!({ post: { ...p1, status: ScheduledPostStatus.PUBLISHED, messageId: 7n } });
    expect(scheduled.posts.value).toEqual([]);
    expect(h.toast).toHaveBeenLastCalledWith({ title: "scheduled_published" });

    const p2 = post("p2", 0, { status: ScheduledPostStatus.FAILED, failure: ScheduledPostFailure.INSUFFICIENT_PERMISSIONS });
    h.handlers.get("ScheduledPostUpdated")!({ post: p2 });
    expect(scheduled.posts.value.map((p) => p.postId)).toEqual(["p2"]);
    expect(h.toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "scheduled_failed", description: "scheduled_failure_permissions", variant: "destructive" }),
    );
  });

  test("rescheduling moves a post and cancelling removes it", async () => {
    const early = post("early", 10);
    const other = post("other", 20);
    h.api.GetScheduledPosts.mockResolvedValue([early, other]);
    const scheduled = useScheduledPosts(() => target);
    await settle();

    h.api.ReschedulePost.mockResolvedValue(new SuccessSchedulePost({ ...early, publishAt: IonDateTime.fromDate(inMinutes(60)) }));
    expect(await scheduled.reschedule("early", inMinutes(60))).toBe(true);
    expect(scheduled.posts.value.map((p) => p.postId)).toEqual(["other", "early"]);

    expect(await scheduled.cancel("other")).toBe(true);
    expect(h.api.CancelScheduledPost).toHaveBeenCalledWith("s1", "c1", "other");
    expect(scheduled.posts.value.map((p) => p.postId)).toEqual(["early"]);
  });

  test("a refused cancel keeps the post and says so", async () => {
    h.api.GetScheduledPosts.mockResolvedValue([post("p1", 10)]);
    h.api.CancelScheduledPost.mockResolvedValue(false);
    const scheduled = useScheduledPosts(() => target);
    await settle();

    expect(await scheduled.cancel("p1")).toBe(false);
    expect(scheduled.posts.value).toHaveLength(1);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "schedule_cancel_failed" }));
  });

  test("a channel is fetched once a session; opening the panel asks again", async () => {
    useScheduledPosts(() => target);
    await settle();
    const again = useScheduledPosts(() => target);
    await settle();
    expect(h.api.GetScheduledPosts).toHaveBeenCalledTimes(1);

    await again.refresh();
    expect(h.api.GetScheduledPosts).toHaveBeenCalledTimes(2);
  });

  test("moderation follows ManageMessages in the channel", () => {
    expect(useScheduledPosts(() => target, { load: false }).canModerate.value).toBe(false);
    h.granted = new Set(["ManageMessages"]);
    expect(useScheduledPosts(() => target, { load: false }).canModerate.value).toBe(true);
  });
});
