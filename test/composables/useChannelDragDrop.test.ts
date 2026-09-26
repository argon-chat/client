/**
 * Dragging a voice member onto another voice channel, or onto a text channel.
 *
 * The sidebar's drag and drop used to know two things, channels and groups. A member is a third.
 * With MoveMember it moves to a voice channel of the same space other than the one it came from;
 * anyone may drop it on a text channel they can write in, which puts the member's mention in that
 * channel's composer. Everything else (group headers, the source itself) has to refuse the drop,
 * which in HTML5 terms means not calling preventDefault on dragover. A move the server refuses is a
 * toast.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";

const h = vi.hoisted(() => ({
  permissions: new Set<string>(["MoveMember", "SendMessages"]),
  deniedIn: new Set<string>(),
  moveMember: vi.fn(async () => true),
  moveChannel: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
  toast: vi.fn(),
  mentionIn: vi.fn(),
}));

vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({
    has: (p: string) => h.permissions.has(p),
    // Channel-level: a channel listed in h.deniedIn has the permission taken away by an overwrite.
    hasIn: (channelId: string, p: string) => h.permissions.has(p) && !h.deniedIn.has(channelId),
  }),
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ channelInteraction: { MoveChannel: h.moveChannel } }),
}));
vi.mock("@/composables/useVoiceModeration", () => ({
  useVoiceModeration: () => ({ moveMember: h.moveMember }),
}));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));

import { ChannelLayoutError, ChannelType, FailedChannelLayout, SuccessChannelLayout } from "@argon/glue";
import { useChannelDragDrop } from "@/composables/useChannelDragDrop";

const voice = (channelId: string, spaceId = "space-1") => ({ channelId, spaceId, type: ChannelType.Voice, groupId: null });
const text = (channelId: string, spaceId = "space-1") => ({ channelId, spaceId, type: ChannelType.Text, groupId: null });

function dragEvent() {
  const data = new Map<string, string>();
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      effectAllowed: "",
      dropEffect: "",
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? "",
    },
    target: null,
    currentTarget: null,
    relatedTarget: null,
  } as unknown as DragEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

function setup() {
  return useChannelDragDrop(ref("space-1"), ref([]), () => [], ref([]), h.mentionIn);
}

beforeEach(() => {
  h.permissions = new Set(["MoveMember", "SendMessages"]);
  h.deniedIn = new Set();
  h.moveMember.mockClear();
  h.moveChannel.mockReset();
  h.moveChannel.mockResolvedValue(new SuccessChannelLayout());
  h.toast.mockClear();
  h.mentionIn.mockClear();
});

describe("starting a member drag", () => {
  test("without MoveMember the member is picked up, but no voice channel takes them", () => {
    h.permissions = new Set(["SendMessages"]);
    const dnd = setup();
    const ev = dragEvent();

    dnd.onMemberDragStart("u1", voice("v1"), ev);

    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(dnd.memberDropStateOf(voice("v2"))).toBeUndefined();
  });

  test("marks the voice channels that would take the drop, and not the text ones", () => {
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    expect(dnd.memberDropStateOf(voice("v2"))).toBe("candidate");
    expect(dnd.memberDropStateOf(voice("v1"))).toBeUndefined();
    expect(dnd.memberDropStateOf(text("t1"))).toBeUndefined();
    expect(dnd.memberDropStateOf(voice("v9", "space-2"))).toBeUndefined();
  });
});

describe("over and onto a channel", () => {
  test("a voice channel accepts, highlights, and the drop moves the member from the source", async () => {
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    const over = dragEvent();
    dnd.onDragOver(voice("v2"), null, 0, over);
    expect(over.preventDefault).toHaveBeenCalled();
    expect(dnd.memberDropStateOf(voice("v2"))).toBe("over");

    await dnd.onDrop(voice("v2"), null, 0, dragEvent());

    expect(h.moveMember).toHaveBeenCalledWith("space-1", "v1", "u1", "v2");
    expect(h.moveChannel).not.toHaveBeenCalled();
    expect(h.mentionIn).not.toHaveBeenCalled();
    expect(dnd.memberDropStateOf(voice("v2"))).toBeUndefined();
  });

  test("the source itself refuses", async () => {
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    const over = dragEvent();
    dnd.onDragOver(voice("v1"), null, 0, over);
    expect(over.preventDefault).not.toHaveBeenCalled();
    await dnd.onDrop(voice("v1"), null, 0, dragEvent());

    expect(h.moveMember).not.toHaveBeenCalled();
  });

  test("a group header is not a target for a member", async () => {
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    const over = dragEvent();
    dnd.onHeaderDragOver("g1", over);
    await dnd.onHeaderDrop("g1", dragEvent());

    expect(over.preventDefault).not.toHaveBeenCalled();
    expect(dnd.dragOverGroupId.value).toBeNull();
    expect(h.moveChannel).not.toHaveBeenCalled();
  });

  test("ending the drag clears the highlight", () => {
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());
    dnd.onDragOver(voice("v2"), null, 0, dragEvent());

    dnd.onDragEnd();

    expect(dnd.memberDropStateOf(voice("v2"))).toBeUndefined();
  });
});

describe("onto a text channel", () => {
  test("lights up under the cursor and the drop mentions the member there", async () => {
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    const over = dragEvent();
    dnd.onDragOver(text("t1"), null, 0, over);
    expect(over.preventDefault).toHaveBeenCalled();
    expect(over.dataTransfer?.dropEffect).toBe("copy");
    expect(dnd.memberDropStateOf(text("t1"))).toBe("over");

    await dnd.onDrop(text("t1"), null, 0, dragEvent());

    expect(h.mentionIn).toHaveBeenCalledWith("t1", "u1");
    expect(h.moveMember).not.toHaveBeenCalled();
    expect(h.moveChannel).not.toHaveBeenCalled();
  });

  test("needs no MoveMember", async () => {
    h.permissions = new Set(["SendMessages"]);
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    await dnd.onDrop(text("t1"), null, 0, dragEvent());

    expect(h.mentionIn).toHaveBeenCalledWith("t1", "u1");
  });

  test("a channel the user cannot write in, or another space's, refuses", async () => {
    h.deniedIn = new Set(["t1"]);
    h.permissions = new Set(["SendMessages"]);
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    for (const target of [text("t1"), text("t2", "space-2")]) {
      const over = dragEvent();
      dnd.onDragOver(target, null, 0, over);
      expect(over.preventDefault).not.toHaveBeenCalled();
      await dnd.onDrop(target, null, 0, dragEvent());
    }
    expect(h.mentionIn).not.toHaveBeenCalled();
  });
});

describe("per-channel MoveMember", () => {
  test("a channel whose overwrite takes MoveMember away is not a target", async () => {
    h.deniedIn = new Set(["v2"]);
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    expect(dnd.memberDropStateOf(voice("v2"))).toBeUndefined();
    expect(dnd.memberDropStateOf(voice("v3"))).toBe("candidate");

    const over = dragEvent();
    dnd.onDragOver(voice("v2"), null, 0, over);
    expect(over.preventDefault).not.toHaveBeenCalled();
    await dnd.onDrop(voice("v2"), null, 0, dragEvent());
    expect(h.moveMember).not.toHaveBeenCalled();
  });

  test("a member picked up where the moderator may not move people goes to no voice channel", async () => {
    h.deniedIn = new Set(["v1"]);
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    expect(dnd.memberDropStateOf(voice("v2"))).toBeUndefined();
    await dnd.onDrop(voice("v2"), null, 0, dragEvent());
    expect(h.moveMember).not.toHaveBeenCalled();
  });
});

describe("dragging a channel", () => {
  test("needs ManageChannels on that channel, not just somewhere in the space", () => {
    h.permissions = new Set(["ManageChannels"]);
    h.deniedIn = new Set(["t1"]);
    const dnd = setup();

    const refused = dragEvent();
    dnd.onDragStart(text("t1"), null, refused);
    expect(refused.preventDefault).toHaveBeenCalled();
    expect(dnd.draggedChannel.value).toBeNull();

    const allowed = dragEvent();
    dnd.onDragStart(text("t2"), null, allowed);
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    expect(dnd.draggedChannel.value?.channelId).toBe("t2");
  });
});

describe("a channel move the server refuses", () => {
  function dropT2OnT3() {
    h.permissions = new Set(["ManageChannels"]);
    const dnd = setup();
    dnd.onDragStart(text("t2"), null, dragEvent());
    return dnd.onDrop(text("t3"), null, 0, dragEvent());
  }

  test("is a toast with the reason", async () => {
    h.moveChannel.mockResolvedValue(new FailedChannelLayout(ChannelLayoutError.NO_PERMISSION));

    await dropT2OnT3();

    expect(h.moveChannel).toHaveBeenCalledWith("space-1", "t2", null, null, null);
    expect(h.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "channel_move_failed", description: "channel_error_no_permission", variant: "destructive" }),
    );
  });

  test("one it takes says nothing", async () => {
    await dropT2OnT3();

    expect(h.moveChannel).toHaveBeenCalledTimes(1);
    expect(h.toast).not.toHaveBeenCalled();
  });
});
