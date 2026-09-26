/**
 * The list behind the "Scheduled" chip: when each post goes out, what it says, and what the
 * viewer may do with it — the author reschedules and cancels, ManageMessages only cancels, and a
 * failed post says why.
 */

import { describe, test, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { IonDateTime } from "@argon-chat/ion.webcore";
import { ScheduledPostFailure, ScheduledPostStatus, type ScheduledPost } from "@argon/glue";

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/data/poolStore", async () => {
  const { computed } = await import("vue");
  return {
    usePoolStore: () => ({
      getUserReactive: (id: { value: string | undefined }) =>
        computed(() => (id.value ? { userId: id.value, displayName: `name of ${id.value}` } : null)),
    }),
  };
});

import ScheduledPostsPanel from "@/components/chats/ScheduledPostsPanel.vue";

function post(postId: string, authorId: string, extra: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    postId,
    spaceId: "s1",
    channelId: "c1",
    authorId,
    text: `text of ${postId}`,
    entities: [],
    publishAt: IonDateTime.fromDate(new Date(Date.now() + 3_600_000)),
    createdAt: IonDateTime.now(),
    status: ScheduledPostStatus.PENDING,
    failure: ScheduledPostFailure.NONE,
    messageId: null,
    ...extra,
  };
}

function render(posts: ScheduledPost[], canModerate = false) {
  return mount(ScheduledPostsPanel, { props: { posts, meId: "me", canModerate } });
}

const row = (w: ReturnType<typeof render>, id: string) => w.find(`[data-testid="scheduled-post-${id}"]`);

describe("the scheduled list", () => {
  test("the author may reschedule and cancel their own post", () => {
    const w = render([post("mine", "me")]);

    expect(row(w, "mine").text()).toContain("text of mine");
    expect(row(w, "mine").find('[data-testid="scheduled-reschedule"]').exists()).toBe(true);
    expect(row(w, "mine").find('[data-testid="scheduled-cancel"]').exists()).toBe(true);
    expect(row(w, "mine").find('[data-testid="scheduled-author"]').exists()).toBe(false);
  });

  test("a moderator sees who wrote somebody else's post and may only cancel it", () => {
    const w = render([post("theirs", "u2")], true);

    expect(row(w, "theirs").find('[data-testid="scheduled-author"]').text()).toBe("name of u2");
    expect(row(w, "theirs").find('[data-testid="scheduled-reschedule"]').exists()).toBe(false);
    expect(row(w, "theirs").find('[data-testid="scheduled-cancel"]').exists()).toBe(true);
  });

  test("without ManageMessages somebody else's post has no actions", () => {
    const w = render([post("theirs", "u2")], false);

    expect(row(w, "theirs").find('[data-testid="scheduled-cancel"]').exists()).toBe(false);
  });

  test("a failed post says why", () => {
    const w = render([post("failed", "me", { status: ScheduledPostStatus.FAILED, failure: ScheduledPostFailure.SLOW_MODE })]);

    expect(row(w, "failed").find('[data-testid="scheduled-failure"]').text()).toBe("scheduled_failure_slow_mode");
  });

  test("a post with only files is labelled as an attachment", () => {
    const w = render([post("files", "me", { text: "" })]);

    expect(row(w, "files").find('[data-testid="scheduled-preview"]').text()).toBe("attachment");
  });

  test("cancel and reschedule go up with the post and the new time", async () => {
    const mine = post("mine", "me");
    const w = render([mine]);

    await row(w, "mine").find('[data-testid="scheduled-cancel"]').trigger("click");
    expect(w.emitted("cancel")?.[0]).toEqual([mine]);

    await row(w, "mine").find('[data-testid="scheduled-reschedule"]').trigger("click");
    await row(w, "mine").find('[data-testid="schedule-preset-in_1h"]').trigger("click");

    const [emittedPost, at] = w.emitted("reschedule")![0] as [ScheduledPost, Date];
    expect(emittedPost).toEqual(mine);
    expect(Math.abs(at.getTime() - (Date.now() + 3_600_000))).toBeLessThan(5_000);
  });

  test("an empty list says so", () => {
    expect(render([]).text()).toContain("scheduled_empty");
  });
});
