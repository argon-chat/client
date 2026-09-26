/**
 * A message in a channel that follows an announcement channel, and the announcement itself.
 *
 * A crosspost is sent in the name of its original author, who is usually not a member here and so
 * not in the local users: the row used to render only when the author was known, which hid every
 * such post. It now renders with the source space's avatar and "Space • #channel" in place of the
 * author, who appears in small print only when known. The "Publish to followers" action shows on an
 * announcement for its author, not on a crosspost and not in a text channel; a published message
 * carries a "Published" mark.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

const h = await vi.hoisted(async () => ({
  users: {} as Record<string, any>,
  stub: (name: string) => ({ default: { name, setup: () => () => null } }),
}));

vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({}) }));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast() {} }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/chat/userColors", () => ({ useUserColors: () => ({ getColorByUserId: () => "#fff" }) }));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ hasIn: () => false, hasInSpace: () => false }) }));
vi.mock("@/store/data/poolStore", async () => {
  const { computed } = await import("vue");
  return {
    usePoolStore: () => ({
      getUserReactive: (id: { value: string | undefined }) => computed(() => (id.value ? h.users[id.value] ?? null : null)),
    }),
  };
});
vi.mock("@/composables/useChannelGroups", () => ({ useChannelGroups: () => ({}) }));
vi.mock("@/lib/linkPreview/settings", async () => {
  const { ref } = await import("vue");
  return { showLinkPreviews: ref(false) };
});

vi.mock("@/components/ArgonAvatar.vue", () => h.stub("ArgonAvatar"));
vi.mock("@/components/popovers/UserProfilePopover.vue", () => h.stub("UserProfilePopover"));
vi.mock("@/components/chats/AttachmentImageGrid.vue", () => h.stub("AttachmentImageGrid"));
vi.mock("@/components/chats/AttachmentFileCard.vue", () => h.stub("AttachmentFileCard"));
vi.mock("@/components/chats/LinkPreviewCard.vue", () => h.stub("LinkPreviewCard"));
vi.mock("@/components/chats/MessageReactions.vue", () => h.stub("MessageReactions"));
vi.mock("@/components/chats/MessageControls.vue", () => h.stub("MessageControls"));
vi.mock("@/components/chats/ReactionPicker.vue", () => h.stub("ReactionPicker"));
vi.mock("@/components/modals/ReportDialog.vue", () => h.stub("ReportDialog"));
// Other features that sit in MessageItem; not under test here.
vi.mock("@/components/chats/MessagePinMarker.vue", () => h.stub("MessagePinMarker"));
vi.mock("@/components/chats/MessagePinMenuItem.vue", () => h.stub("MessagePinMenuItem"));
vi.mock("@/components/chats/AnnouncementCard.vue", () => h.stub("AnnouncementCard"));
vi.mock("@/components/chats/MessageWebhookAuthor.vue", () => h.stub("MessageWebhookAuthor"));
vi.mock("@/components/chats/ChatSegment.vue", async () => {
  const { defineComponent, h: hh } = await import("vue");
  return {
    default: defineComponent({ props: { text: String, entity: Object }, setup: (p) => () => hh("span", p.text) }),
  };
});

import { IonDateTime } from "@argon-chat/ion.webcore";
import MessageItem from "@/components/MessageItem.vue";

const crosspost = {
  sourceSpaceId: "src-space",
  sourceChannelId: "news",
  sourceMessageId: 7n,
  sourceSpaceName: "Argon",
  sourceChannelName: "news",
  sourceSpaceAvatarFileId: null,
};

const message = (extra: Record<string, unknown> = {}) =>
  ({
    messageId: 1n,
    replyId: null,
    channelId: "c1",
    spaceId: "s1",
    text: "Release notes",
    entities: [],
    timeSent: IonDateTime.fromDate(new Date("2026-09-26T10:00:00Z")),
    sender: "author",
    reactions: [],
    controls: null,
    editedAt: null,
    crosspost: null,
    publishedAt: null,
    ...extra,
  }) as any;

let mounted: VueWrapper[] = [];

afterEach(() => {
  for (const w of mounted) w.unmount();
  mounted = [];
  h.users = {};
  document.body.innerHTML = "";
});

async function render(msg: any, props: Record<string, unknown> = {}) {
  const w = mount(MessageItem, {
    attachTo: document.body,
    props: { message: msg, getMsgById: () => ({}) as any, isFirstInGroup: true, ...props },
  });
  mounted.push(w);
  await nextTick();
  return w;
}

async function hover(w: VueWrapper) {
  await w.find(".msg-bubble-wrap").trigger("mouseenter");
  await nextTick();
}

const publishButton = () => document.body.querySelector<HTMLButtonElement>('button[title="publish_to_followers"]');

describe("a crosspost", () => {
  test("renders though its author is not known here, headed by where it was published", async () => {
    const w = await render(message({ crosspost }));

    expect(w.text()).toContain("Release notes");
    expect(w.find('[data-testid="crosspost-header"]').text()).toContain("Argon • #news");
    expect(w.text()).toContain("crosspost_tag");
    expect(w.find('[data-testid="crosspost-avatar"]').exists()).toBe(true);
    // Nobody to name: no raw id, no "unknown user".
    expect(w.find('[data-testid="crosspost-author"]').exists()).toBe(false);
    expect(w.text()).not.toContain("author");
    expect(w.text()).not.toContain("unknown_display_name");
  });

  test("names its author in small print when they are known", async () => {
    h.users.author = { userId: "author", displayName: "Ada" };
    const w = await render(message({ crosspost }));
    expect(w.find('[data-testid="crosspost-author"]').text()).toBe('crosspost_by:{"name":"Ada"}');
  });

  test("a normal message by an unknown author still waits for the author", async () => {
    const w = await render(message());
    expect(w.text()).not.toContain("Release notes");
  });

  test("is never offered for publishing, even to a moderator", async () => {
    h.users.me = { userId: "me", displayName: "Me" };
    const w = await render(message({ crosspost, sender: "me" }), { channelType: "announcement", canPublishAny: true });
    await hover(w);
    expect(document.body.querySelector('button[title="copy"]')).not.toBeNull();
    expect(publishButton()).toBeNull();
  });

  test("is taken down only with ManageMessages, not by its author", async () => {
    h.users.me = { userId: "me", displayName: "Me" };
    const deleteButton = () => document.body.querySelector('button[title="delete_message_action_hint"]');

    const w = await render(message({ crosspost, sender: "me" }), { canDeleteOwn: true });
    await hover(w);
    expect(deleteButton()).toBeNull();

    await w.setProps({ canDeleteAny: true });
    await hover(w);
    expect(deleteButton()).not.toBeNull();
  });
});

describe("publishing", () => {
  test("the author of an announcement can publish it", async () => {
    h.users.me = { userId: "me", displayName: "Me" };
    const msg = message({ sender: "me" });
    const w = await render(msg, { channelType: "announcement" });
    await hover(w);

    const button = publishButton();
    expect(button).not.toBeNull();
    button!.click();
    expect(w.emitted("publish")?.[0]).toEqual([msg]);
  });

  test("not in a text channel", async () => {
    h.users.me = { userId: "me", displayName: "Me" };
    const w = await render(message({ sender: "me" }), { channelType: "text", canPublishAny: true });
    await hover(w);
    expect(publishButton()).toBeNull();
  });

  test("somebody else's announcement only with ManageMessages", async () => {
    h.users.author = { userId: "author", displayName: "Ada" };
    const w = await render(message(), { channelType: "announcement" });
    await hover(w);
    expect(publishButton()).toBeNull();

    await w.setProps({ canPublishAny: true });
    await hover(w);
    expect(publishButton()).not.toBeNull();
  });

  test("once published, it carries the mark and is not offered again", async () => {
    h.users.me = { userId: "me", displayName: "Me" };
    const w = await render(message({ sender: "me", publishedAt: IonDateTime.now() }), { channelType: "announcement" });
    expect(w.find('[data-testid="published-mark"]').text()).toContain("message_published");
    await hover(w);
    expect(publishButton()).toBeNull();
  });
});
