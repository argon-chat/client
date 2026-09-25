/**
 * Dragging a voice member onto another voice channel.
 *
 * The sidebar's drag and drop used to know two things, channels and groups. A member is a third,
 * and it must only ever land on a voice channel of the same space other than the one it came from;
 * everything else (text channels, group headers, the source itself) has to refuse the drop, which
 * in HTML5 terms means not calling preventDefault on dragover.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";

const h = vi.hoisted(() => ({
  permissions: new Set<string>(["MoveMember"]),
  moveMember: vi.fn(async () => true),
  moveChannel: vi.fn(async () => {}),
}));

vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({ has: (p: string) => h.permissions.has(p) }),
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ channelInteraction: { MoveChannel: h.moveChannel } }),
}));
vi.mock("@/composables/useVoiceModeration", () => ({
  useVoiceModeration: () => ({ moveMember: h.moveMember }),
}));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));

import { ChannelType } from "@argon/glue";
import { useChannelDragDrop } from "@/composables/useChannelDragDrop";

const voice = (channelId: string, spaceId = "space-1") => ({ channelId, spaceId, type: ChannelType.Voice, groupId: null });
const text = (channelId: string) => ({ channelId, spaceId: "space-1", type: ChannelType.Text, groupId: null });

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
  return useChannelDragDrop(ref("space-1"), ref([]), () => [], ref([]));
}

beforeEach(() => {
  h.permissions = new Set(["MoveMember"]);
  h.moveMember.mockClear();
  h.moveChannel.mockClear();
});

describe("starting a member drag", () => {
  test("needs MoveMember", () => {
    h.permissions.clear();
    const dnd = setup();
    const ev = dragEvent();

    dnd.onMemberDragStart("u1", voice("v1"), ev);

    expect(ev.preventDefault).toHaveBeenCalled();
    expect(dnd.voiceDropStateOf(voice("v2"))).toBeUndefined();
  });

  test("marks the channels that would take the drop", () => {
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    expect(dnd.voiceDropStateOf(voice("v2"))).toBe("candidate");
    expect(dnd.voiceDropStateOf(voice("v1"))).toBeUndefined();
    expect(dnd.voiceDropStateOf(text("t1") as any)).toBeUndefined();
    expect(dnd.voiceDropStateOf(voice("v9", "space-2"))).toBeUndefined();
  });
});

describe("over and onto a channel", () => {
  test("a voice channel accepts, highlights, and the drop moves the member from the source", async () => {
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    const over = dragEvent();
    dnd.onDragOver(voice("v2"), null, 0, over);
    expect(over.preventDefault).toHaveBeenCalled();
    expect(dnd.voiceDropStateOf(voice("v2"))).toBe("over");

    await dnd.onDrop(voice("v2"), null, 0, dragEvent());

    expect(h.moveMember).toHaveBeenCalledWith("space-1", "v1", "u1", "v2");
    expect(h.moveChannel).not.toHaveBeenCalled();
    expect(dnd.voiceDropStateOf(voice("v2"))).toBeUndefined();
  });

  test("a text channel, and the source itself, refuse", async () => {
    const dnd = setup();
    dnd.onMemberDragStart("u1", voice("v1"), dragEvent());

    for (const target of [text("t1"), voice("v1")]) {
      const over = dragEvent();
      dnd.onDragOver(target, null, 0, over);
      expect(over.preventDefault).not.toHaveBeenCalled();
      await dnd.onDrop(target, null, 0, dragEvent());
    }
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

    expect(dnd.voiceDropStateOf(voice("v2"))).toBeUndefined();
  });
});
