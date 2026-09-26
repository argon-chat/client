/**
 * Pinned messages of a channel: loaded newest first, changed through pin/unpin with a toast on a
 * refusal, and kept current by MessagePinned / MessageUnpinned / MessageDeleted / MessageUpdated.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { IonDateTime } from "@argon-chat/ion.webcore";
import {
  FailedPinMessage,
  FailedUnpinMessage,
  PinMessageError,
  SuccessPinMessage,
  SuccessUnpinMessage,
} from "@argon/glue";

type Handler = (ev: any) => void;

const h = await vi.hoisted(async () => {
  const { vi } = await import("vitest");
  return {
    handlers: new Map<string, Handler[]>(),
    granted: true,
    getPinned: vi.fn(),
    pinMessage: vi.fn(),
    unpinMessage: vi.fn(),
    cached: vi.fn(),
    toast: vi.fn(),
  };
});

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} },
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelPinsInteraction: {
      GetPinnedMessages: (...a: unknown[]) => h.getPinned(...a),
      PinMessage: (...a: unknown[]) => h.pinMessage(...a),
      UnpinMessage: (...a: unknown[]) => h.unpinMessage(...a),
    },
  }),
}));
vi.mock("@/store/realtime/busStore", () => ({
  useBus: () => ({
    onServerEvent: (event: string, handler: Handler) => {
      h.handlers.set(event, [...(h.handlers.get(event) ?? []), handler]);
      return { unsubscribe() {} };
    },
  }),
}));
vi.mock("@/store/data/messageStore", () => ({
  useMessageStore: () => ({ getMessageById: (id: bigint) => h.cached(id) }),
}));
vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({ hasIn: (_c: string, flag: string) => h.granted && flag === "ManageMessages" }),
}));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));

import { useChannelPins, pinErrorKey } from "@/composables/useChannelPins";
import { PIN_CHANNELS_KEPT, PIN_TTL_MS, usePinStore } from "@/store/data/pinStore";
import { runSessionReset } from "@/store/system/sessionLifecycle";

const message = (messageId: bigint, channelId = "c1", text = `m${messageId}`) =>
  ({ messageId, channelId, spaceId: "s1", text, entities: [], sender: "u1" }) as any;

const at = (seconds: number) => new IonDateTime(BigInt(seconds) * 10_000_000n);

const pinned = (messageId: bigint, seconds: number, channelId = "c1") =>
  ({ message: message(messageId, channelId), pinnedBy: "mod", pinnedAt: at(seconds) }) as any;

const fire = (event: string, payload: unknown) => {
  for (const handler of h.handlers.get(event) ?? []) handler(payload);
};

const settle = () => new Promise((r) => setTimeout(r, 0));

const ids = (pins: readonly any[]) => pins.map((p) => p.message.messageId);

async function opened(pins: any[] = []) {
  h.getPinned.mockResolvedValueOnce(pins);
  const chan = useChannelPins(() => "c1", () => "s1");
  await chan.refresh();
  return chan;
}

beforeEach(() => {
  setActivePinia(createPinia());
  h.handlers.clear();
  h.granted = true;
  h.getPinned.mockReset();
  h.pinMessage.mockReset();
  h.unpinMessage.mockReset();
  h.cached.mockReset();
  h.toast.mockReset();
});

describe("loading", () => {
  test("pins arrive newest first and mark their messages", async () => {
    const chan = await opened([pinned(1n, 10), pinned(3n, 30), pinned(2n, 20)]);

    expect(h.getPinned).toHaveBeenCalledWith("s1", "c1");
    expect(ids(chan.pins.value)).toEqual([3n, 2n, 1n]);
    expect(chan.count.value).toBe(3);
    expect(chan.loaded.value).toBe(true);
    expect(chan.isPinned(2n)).toBe(true);
    expect(chan.isPinned(9n)).toBe(false);
  });

  test("a channel is not loaded until asked, and two opens share one request", async () => {
    let release!: (v: unknown) => void;
    h.getPinned.mockReturnValueOnce(new Promise((r) => (release = r)));
    const chan = useChannelPins(() => "c1", () => "s1");

    expect(chan.loaded.value).toBe(false);
    const first = chan.refresh();
    const second = chan.refresh();
    release([pinned(1n, 1)]);
    await Promise.all([first, second]);

    expect(h.getPinned).toHaveBeenCalledTimes(1);
    expect(chan.count.value).toBe(1);
  });

  test("ManageMessages decides whether pins can be changed", async () => {
    expect(useChannelPins(() => "c1", () => "s1").canManage.value).toBe(true);
    h.granted = false;
    expect(useChannelPins(() => "c1", () => "s1").canManage.value).toBe(false);
  });
});

describe("pinning and unpinning", () => {
  test("a pin goes to the top of the list", async () => {
    const chan = await opened([pinned(1n, 10)]);
    h.pinMessage.mockResolvedValueOnce(new SuccessPinMessage(pinned(5n, 50)));

    expect(await chan.pin(5n)).toBe(true);

    expect(h.pinMessage).toHaveBeenCalledWith("s1", "c1", 5n);
    expect(ids(chan.pins.value)).toEqual([5n, 1n]);
    expect(h.toast).not.toHaveBeenCalled();
  });

  test("toggle unpins a pinned message", async () => {
    const chan = await opened([pinned(1n, 10), pinned(2n, 20)]);
    h.unpinMessage.mockResolvedValueOnce(new SuccessUnpinMessage());

    expect(await chan.toggle(1n)).toBe(true);

    expect(h.unpinMessage).toHaveBeenCalledWith("s1", "c1", 1n);
    expect(ids(chan.pins.value)).toEqual([2n]);
  });

  test("the limit is refused with its own explanation", async () => {
    const chan = await opened([pinned(1n, 10)]);
    h.pinMessage.mockResolvedValueOnce(new FailedPinMessage(PinMessageError.PIN_LIMIT_REACHED));

    expect(await chan.pin(2n)).toBe(false);

    expect(ids(chan.pins.value)).toEqual([1n]);
    expect(h.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "pins_pin_failed", description: "pins_error_limit", variant: "destructive" }),
    );
  });

  test("a refused unpin keeps the pin and says why", async () => {
    const chan = await opened([pinned(1n, 10)]);
    h.unpinMessage.mockResolvedValueOnce(new FailedUnpinMessage(PinMessageError.INSUFFICIENT_PERMISSIONS));

    expect(await chan.unpin(1n)).toBe(false);

    expect(chan.isPinned(1n)).toBe(true);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "pins_error_no_permission" }));
  });

  test("a network failure is reported, not thrown", async () => {
    const chan = await opened();
    h.pinMessage.mockRejectedValueOnce(new Error("offline"));

    expect(await chan.pin(1n)).toBe(false);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "pins_error_unknown" }));
  });

  test("errors map to their explanations", () => {
    expect(pinErrorKey(PinMessageError.MESSAGE_NOT_FOUND)).toBe("pins_error_not_found");
    expect(pinErrorKey(PinMessageError.NOT_A_TEXT_CHANNEL)).toBe("pins_error_unknown");
    expect(pinErrorKey(null)).toBe("pins_error_unknown");
  });
});

describe("live updates", () => {
  test("a pin by someone else uses the cached message when there is one", async () => {
    const chan = await opened([pinned(1n, 10)]);
    h.cached.mockResolvedValueOnce(message(7n, "c1", "rules"));

    fire("MessagePinned", { spaceId: "s1", channelId: "c1", messageId: 7n, byUserId: "mod" });
    await settle();

    expect(ids(chan.pins.value)).toEqual([7n, 1n]);
    expect(chan.pins.value[0].pinnedBy).toBe("mod");
    expect(chan.pins.value[0].message.text).toBe("rules");
    expect(h.getPinned).toHaveBeenCalledTimes(1);
  });

  test("a pin of a message not in the cache marks the list stale; the next refresh asks, not the event", async () => {
    const chan = await opened([pinned(1n, 10)]);
    h.cached.mockResolvedValueOnce(undefined);

    fire("MessagePinned", { spaceId: "s1", channelId: "c1", messageId: 8n, byUserId: "mod" });
    await settle();
    await settle();

    // Every viewer of the channel gets the event: asking at once would be all of them at once.
    expect(h.getPinned).toHaveBeenCalledTimes(1);
    expect(ids(chan.pins.value)).toEqual([1n]);

    // The panel opening: stale, so asked for although well inside the TTL.
    h.getPinned.mockResolvedValueOnce([pinned(1n, 10), pinned(8n, 80)]);
    await chan.refresh();

    expect(h.getPinned).toHaveBeenCalledTimes(2);
    expect(ids(chan.pins.value)).toEqual([8n, 1n]);
  });

  test("a cached row of another message under the same rounded key is not taken for the pinned one", async () => {
    const chan = await opened([pinned(1n, 10)]);
    // The cache is keyed by Number(messageId): past 2^53, two snowflakes can share a key.
    h.cached.mockResolvedValueOnce(message(2n ** 60n + 1n, "c1", "someone else's"));

    fire("MessagePinned", { spaceId: "s1", channelId: "c1", messageId: 2n ** 60n + 2n, byUserId: "mod" });
    await settle();

    expect(ids(chan.pins.value)).toEqual([1n]);
    h.getPinned.mockResolvedValueOnce([pinned(1n, 10), pinned(2n ** 60n + 2n, 20)]);
    await chan.refresh();
    expect(ids(chan.pins.value)).toEqual([2n ** 60n + 2n, 1n]);
  });

  test("events for a channel that was never opened are ignored", async () => {
    const chan = useChannelPins(() => "c2", () => "s1");
    usePinStore();

    fire("MessagePinned", { spaceId: "s1", channelId: "c2", messageId: 1n, byUserId: "mod" });
    await settle();

    expect(h.cached).not.toHaveBeenCalled();
    expect(h.getPinned).not.toHaveBeenCalled();
    expect(chan.loaded.value).toBe(false);
  });

  test("unpinned and deleted messages leave the list", async () => {
    const chan = await opened([pinned(1n, 10), pinned(2n, 20), pinned(3n, 30)]);

    fire("MessageUnpinned", { spaceId: "s1", channelId: "c1", messageId: 2n, byUserId: "mod" });
    fire("MessageDeleted", { spaceId: "s1", channelId: "c1", messageId: 3n, byUserId: "u1" });
    fire("MessageUnpinned", { spaceId: "s1", channelId: "other", messageId: 1n, byUserId: "mod" });

    expect(ids(chan.pins.value)).toEqual([1n]);
  });

  test("an edited pinned message shows its new text", async () => {
    const chan = await opened([pinned(1n, 10)]);

    fire("MessageUpdated", { spaceId: "s1", channelId: "c1", message: message(1n, "c1", "edited") });

    expect(chan.pins.value[0].message.text).toBe("edited");
    expect(chan.pins.value[0].pinnedBy).toBe("mod");
  });
});

describe("keeping pins between opens", () => {
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
  });

  test("a channel opened again within the TTL is not asked for again; after it, it is", async () => {
    const chan = await opened([pinned(1n, 10)]);

    clock += PIN_TTL_MS - 1;
    await chan.refresh();
    expect(h.getPinned).toHaveBeenCalledTimes(1);

    clock += 1;
    h.getPinned.mockResolvedValueOnce([pinned(1n, 10), pinned(2n, 20)]);
    await chan.refresh();
    expect(h.getPinned).toHaveBeenCalledTimes(2);
    expect(ids(chan.pins.value)).toEqual([2n, 1n]);
  });

  test("a forced refresh (after a reconnect) asks inside the TTL too", async () => {
    const chan = await opened([pinned(1n, 10)]);
    h.getPinned.mockResolvedValueOnce([]);

    await chan.refresh(true);

    expect(h.getPinned).toHaveBeenCalledTimes(2);
    expect(chan.count.value).toBe(0);
  });

  test(`only the ${PIN_CHANNELS_KEPT} most recently opened channels are kept`, async () => {
    const channels = Array.from({ length: PIN_CHANNELS_KEPT + 1 }, (_, i) => `c${i}`);
    h.getPinned.mockImplementation(async (_s: string, c: string) => [pinned(1n, 10, c)]);
    for (const c of channels.slice(0, PIN_CHANNELS_KEPT)) await useChannelPins(() => c, () => "s1").refresh();
    // c0 opened again: now the most recent, so c1 is the one to go.
    await useChannelPins(() => "c0", () => "s1").refresh();
    await useChannelPins(() => channels[PIN_CHANNELS_KEPT], () => "s1").refresh();

    const store = usePinStore();
    expect(store.isLoaded("c0")).toBe(true);
    expect(store.isLoaded("c1")).toBe(false);
    expect(channels.filter((c) => store.isLoaded(c))).toHaveLength(PIN_CHANNELS_KEPT);
  });

  test("a failed load says so instead of loading forever, and trying again can succeed", async () => {
    h.getPinned.mockRejectedValueOnce(new Error("offline"));
    const chan = useChannelPins(() => "c1", () => "s1");

    await chan.refresh();
    expect(chan.loaded.value).toBe(false);
    expect(chan.failed.value).toBe(true);

    h.getPinned.mockResolvedValueOnce([pinned(1n, 10)]);
    await chan.refresh(true);
    expect(chan.failed.value).toBe(false);
    expect(chan.count.value).toBe(1);
  });

  test("a load that answers after an account switch is dropped", async () => {
    let answer!: (v: unknown) => void;
    h.getPinned.mockReturnValueOnce(new Promise((r) => (answer = r)));
    const chan = useChannelPins(() => "c1", () => "s1");

    const loading = chan.refresh();
    await runSessionReset();
    answer([pinned(1n, 10)]);
    await loading;

    expect(chan.loaded.value).toBe(false);
  });
});
