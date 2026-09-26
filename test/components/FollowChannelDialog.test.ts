/**
 * The follow dialog of an announcement channel: pick one of your spaces where you manage channels,
 * then a text or announcement channel there, and follow. The channel being followed is never on
 * offer; a user with nowhere to follow into is told so rather than shown empty lists; a refusal
 * from the server keeps the dialog open with its reason.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

const h = await vi.hoisted(async () => {
  const { ref } = await import("vue");
  const { vi } = await import("vitest");
  return {
    follow: vi.fn(),
    toast: vi.fn(),
    spaces: ref<any[]>([]),
    channelsBySpace: {} as Record<string, any[]>,
    manageSpaces: new Set<string>(),
    manageChannels: new Set<string>(),
  };
});

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ channelFollowInteraction: { FollowChannel: h.follow } }),
}));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({
    hasInSpace: (spaceId: string, flag: string) => flag === "ManageChannels" && h.manageSpaces.has(spaceId),
    hasIn: (channelId: string, flag: string) => flag === "ManageChannels" && h.manageChannels.has(channelId),
  }),
}));
vi.mock("@/store/data/poolStore", async () => {
  const { computed } = await import("vue");
  return {
    usePoolStore: () => ({
      useAllServers: () => h.spaces,
      useActiveServerChannels: (spaceId: { value: string | null }) =>
        computed(() => (spaceId.value ? h.channelsBySpace[spaceId.value] ?? [] : [])),
    }),
  };
});
vi.mock("@/composables/useChannelGroups", async () => {
  const { ref } = await import("vue");
  return { useChannelGroups: () => ({ channelGroups: ref([]) }) };
});
vi.mock("@/components/ArgonAvatar.vue", () => ({ default: { name: "ArgonAvatar", setup: () => () => null } }));

import { ChannelType, FailedFollowChannel, FollowChannelError, SuccessFollowChannel } from "@argon/glue";
import FollowChannelDialog from "@/components/channels/FollowChannelDialog.vue";

const channel = (channelId: string, spaceId: string, extra: Record<string, unknown> = {}) =>
  ({ channelId, spaceId, name: channelId, type: ChannelType.Text, groupId: null, fractionalIndex: null, ...extra }) as any;

let mounted: VueWrapper[] = [];

afterEach(() => {
  for (const w of mounted) w.unmount();
  mounted = [];
  document.body.innerHTML = "";
});

beforeEach(() => {
  h.follow.mockReset();
  h.toast.mockReset();
  h.spaces.value = [
    { spaceId: "src", name: "Source space", avatarFieldId: null },
    { spaceId: "mine", name: "My space", avatarFieldId: null },
    { spaceId: "guest", name: "Just a member", avatarFieldId: null },
  ];
  h.manageSpaces = new Set(["src", "mine"]);
  h.manageChannels = new Set(["news", "general", "updates"]);
  h.channelsBySpace = {
    src: [channel("news", "src", { type: ChannelType.Announcement })],
    mine: [
      channel("general", "mine"),
      channel("updates", "mine", { type: ChannelType.Announcement }),
      channel("lounge", "mine", { type: ChannelType.Voice }),
      channel("staff", "mine"),
    ],
  };
});

const flush = async () => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

async function render() {
  const w = mount(FollowChannelDialog, {
    attachTo: document.body,
    props: { open: true, spaceId: "src", channelId: "news", channelName: "news" },
  });
  mounted.push(w);
  await flush();
  return w;
}

const $ = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)];
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  el!.click();
  await flush();
};
const confirmButton = () => $('[data-testid="follow-confirm"]') as HTMLButtonElement;

describe("what can be picked", () => {
  test("only the spaces where the user manages channels", async () => {
    await render();
    expect($$("[data-space]").map((el) => el.dataset.space)).toEqual(["mine", "src"]);
    expect(confirmButton().disabled).toBe(true);
  });

  test("in a space: its text and announcement channels the user manages", async () => {
    await render();
    await click($('[data-space="mine"]'));
    expect($$("[data-channel]").map((el) => el.dataset.channel)).toEqual(["general", "updates"]);
  });

  test("the channel being followed is not on offer", async () => {
    await render();
    await click($('[data-space="src"]'));
    expect($$("[data-channel]")).toHaveLength(0);
    expect($('[data-testid="follow-no-channels"]')?.textContent).toContain("follow_no_channels");
  });

  test("with no space to follow into, the dialog says so", async () => {
    h.manageSpaces = new Set();
    await render();
    expect($('[data-testid="follow-no-spaces"]')?.textContent).toContain("follow_no_spaces");
    expect($('[data-testid="follow-spaces"]')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });

  test("a single space is picked for the user", async () => {
    h.manageSpaces = new Set(["mine"]);
    await render();
    expect($('[data-space="mine"]')?.getAttribute("aria-selected")).toBe("true");
    expect($$("[data-channel]").map((el) => el.dataset.channel)).toEqual(["general", "updates"]);
  });
});

describe("following", () => {
  test("follows the picked channel, says so and closes", async () => {
    h.follow.mockResolvedValue(
      new SuccessFollowChannel({ followId: "f1", sourceChannelName: "news", targetChannelName: "updates" } as any),
    );
    const w = await render();
    await click($('[data-space="mine"]'));
    await click($('[data-channel="updates"]'));
    expect(confirmButton().disabled).toBe(false);

    await click(confirmButton());

    expect(h.follow).toHaveBeenCalledWith("src", "news", "mine", "updates");
    expect(h.toast).toHaveBeenCalledWith({ title: 'follow_success:{"target":"updates","source":"news"}' });
    expect(w.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  test("a refusal keeps the dialog open and gives the reason", async () => {
    h.follow.mockResolvedValue(new FailedFollowChannel(FollowChannelError.TOO_MANY_FOLLOWS));
    const w = await render();
    await click($('[data-space="mine"]'));
    await click($('[data-channel="general"]'));
    await click(confirmButton());

    expect(h.toast).toHaveBeenCalledWith({
      title: "follow_failed",
      description: "follow_error_too_many",
      variant: "destructive",
    });
    expect(w.emitted("update:open")).toBeUndefined();
    expect(confirmButton().disabled).toBe(false);
  });

  test("switching space drops the channel picked in the other one", async () => {
    await render();
    await click($('[data-space="mine"]'));
    await click($('[data-channel="general"]'));
    expect(confirmButton().disabled).toBe(false);

    await click($('[data-space="src"]'));
    expect(confirmButton().disabled).toBe(true);
  });
});
