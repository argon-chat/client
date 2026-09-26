/**
 * The on-screen radio key is a hold, and a hold has to end. What these pin: pointer down keys the
 * radio once; pointer up releases it once and later "release" events are no-ops; losing the radio
 * under a held key (the mode switched off, the right revoked) releases it; and so does the
 * component going away. The control shows only to a member of a broadcast channel who may
 * transmit, and never on a mobile layout.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

const h = await vi.hoisted(async () => {
  const { reactive, ref } = await import("vue");
  const { vi } = await import("vitest");
  return {
    voice: reactive({
      mode: "channel" as "none" | "dm" | "channel",
      connectedVoiceChannelId: "hq" as string | null,
      radio: {
        available: true,
        connecting: false,
        transmitting: false,
        busyBy: null as string | null,
        unavailableReason: null as string | null,
        settings: null,
        onAir: [] as unknown[],
      },
      radioKeyDown: vi.fn(),
      radioKeyUp: vi.fn(),
    }),
    canBroadcast: ref(true),
    mobile: false,
    rows: new Map<string, any>(),
  };
});

vi.mock("@/store/media/unifiedCallStore", () => ({ useUnifiedCall: () => h.voice }));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ realtimeChannelUsers: new Map() }) }));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
vi.mock("@/composables/useCallPermissions", () => ({ useCallPermissions: () => ({ canBroadcast: h.canBroadcast }) }));
vi.mock("@/lib/platform", () => ({ isMobileLayout: () => h.mobile }));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@/store/db/dexie", () => ({ db: { channels: { get: async (id: string) => h.rows.get(id) } } }));
vi.mock("dexie", () => ({
  liveQuery: (fn: () => Promise<unknown>) => ({
    subscribe: ({ next }: { next: (row: unknown) => void }) => {
      void fn().then(next);
      return { unsubscribe() {} };
    },
  }),
}));

import RadioControl from "@/components/media/RadioControl.vue";

const flush = async () => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

const hq = (broadcast: unknown = { targets: ["p1"] }) =>
  ({ channelId: "hq", spaceId: "s1", name: "HQ", type: 1, broadcast }) as any;

// Every instance watches the radio and the window; one left mounted from an earlier test would
// answer the next test's events too.
let mounted: ReturnType<typeof mount> | null = null;

async function render() {
  const w = mount(RadioControl);
  mounted = w;
  await flush();
  return w;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const key = (w: ReturnType<typeof mount>) => w.find('[data-testid="radio-hold"]');

beforeEach(() => {
  h.voice.mode = "channel";
  h.voice.connectedVoiceChannelId = "hq";
  Object.assign(h.voice.radio, { available: true, connecting: false, transmitting: false, busyBy: null, unavailableReason: null });
  h.voice.radioKeyDown.mockClear();
  h.voice.radioKeyUp.mockClear();
  h.canBroadcast.value = true;
  h.mobile = false;
  h.rows = new Map([["hq", hq()]]);
});

describe("when it shows", () => {
  test("a broadcast channel member who may transmit gets the key, ready", async () => {
    const w = await render();
    expect(key(w).exists()).toBe(true);
    expect(key(w).attributes("disabled")).toBeUndefined();
    expect(w.find(".radio-status").attributes("data-state")).toBe("ready");
    expect(w.find(".radio-status").text()).toContain("radio_ready");
  });

  test("not in a plain voice channel", async () => {
    h.rows = new Map([["hq", hq(null)]]);
    const w = await render();
    expect(w.find('[data-testid="radio-control"]').exists()).toBe(false);
  });

  test("not without the Broadcast right", async () => {
    h.canBroadcast.value = false;
    const w = await render();
    expect(w.find('[data-testid="radio-control"]').exists()).toBe(false);
  });

  test("never on a mobile layout", async () => {
    h.mobile = true;
    const w = await render();
    expect(w.find('[data-testid="radio-control"]').exists()).toBe(false);
  });

  test("the status says why the key is unavailable, and the key is disabled", async () => {
    h.voice.radio.available = false;
    h.voice.radio.unavailableReason = "server_restricted";
    const w = await render();
    expect(w.find(".radio-status").attributes("data-state")).toBe("unavailable");
    expect(w.find(".radio-status").text()).toContain("radio_unavailable_server_restricted");
    expect(key(w).attributes("disabled")).toBeDefined();
  });

  test("busy names the other speaker", async () => {
    h.voice.radio.busyBy = "bob";
    const w = await render();
    expect(w.find(".radio-status").attributes("data-state")).toBe("busy");
    expect(w.find(".radio-status").text()).toContain("radio_busy");
  });
});

describe("the hold", () => {
  test("pointer down keys the radio, pointer up releases it, and later ends are no-ops", async () => {
    const w = await render();
    await key(w).trigger("pointerdown", { button: 0 });
    expect(h.voice.radioKeyDown).toHaveBeenCalledTimes(1);
    expect(h.voice.radioKeyUp).not.toHaveBeenCalled();

    await key(w).trigger("pointerup");
    expect(h.voice.radioKeyUp).toHaveBeenCalledTimes(1);

    await key(w).trigger("pointerleave");
    await key(w).trigger("blur");
    expect(h.voice.radioKeyUp).toHaveBeenCalledTimes(1);
  });

  test("a second pointer down while held does not key twice", async () => {
    const w = await render();
    await key(w).trigger("pointerdown", { button: 0 });
    await key(w).trigger("pointerdown", { button: 0 });
    expect(h.voice.radioKeyDown).toHaveBeenCalledTimes(1);
  });

  test("a right-button press is not a hold", async () => {
    const w = await render();
    await key(w).trigger("pointerdown", { button: 2 });
    expect(h.voice.radioKeyDown).not.toHaveBeenCalled();
  });

  test("unmounting while held releases the key", async () => {
    const w = await render();
    await key(w).trigger("pointerdown", { button: 0 });
    expect(h.voice.radioKeyDown).toHaveBeenCalledTimes(1);

    w.unmount();
    expect(h.voice.radioKeyUp).toHaveBeenCalledTimes(1);
  });

  test("unmounting without a hold releases nothing", async () => {
    const w = await render();
    w.unmount();
    expect(h.voice.radioKeyUp).not.toHaveBeenCalled();
  });

  test("the radio going away under a held key releases it, once", async () => {
    const w = await render();
    await key(w).trigger("pointerdown", { button: 0 });

    h.voice.radio.available = false;
    h.voice.radio.unavailableReason = "not_a_broadcast_channel";
    await nextTick();
    expect(h.voice.radioKeyUp).toHaveBeenCalledTimes(1);

    // The pointer eventually comes up on a key that already let go.
    await key(w).trigger("pointerup");
    expect(h.voice.radioKeyUp).toHaveBeenCalledTimes(1);
  });

  test("the window losing focus releases a held key", async () => {
    const w = await render();
    await key(w).trigger("pointerdown", { button: 0 });
    window.dispatchEvent(new Event("blur"));
    expect(h.voice.radioKeyUp).toHaveBeenCalledTimes(1);
  });
});
