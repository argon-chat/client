/**
 * The hotkey store: what reaches the host, what comes back, and the one-off migration.
 *
 * The host is a fake here (the real one is Electron); the store's job is to keep it fed with the
 * current bindings, to turn its events into action events, and to carry over what people had
 * bound before the rework. The regressions worth guarding: a migration that silently drops a
 * push-to-talk key, a host that keeps stale bindings after the master switch goes off, and a
 * cancelled recording that leaves the field stuck in "recording".
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import superjson from "superjson";

const host = vi.hoisted(() => ({
  available: true,
  setBindings: vi.fn(async (_bindings: unknown) => true),
  status: vi.fn(async () => ({ running: true, platform: "win32", accessibilityGranted: true, error: null, restarts: 0 })),
  restart: vi.fn(async () => true),
  captureOnce: vi.fn(async (): Promise<unknown> => ({ buttons: [] })),
  cancelCapture: vi.fn(async () => {}),
  onFired: vi.fn((_cb: (id: string, phase: "down" | "up") => void) => null),
  toggleMainWindow: vi.fn(async () => true),
  showMainWindow: vi.fn(async () => true),
}));

vi.mock("@/lib/hotkeys/host", () => ({
  hotkeyHost: host,
  captureFailureReason: (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return /hotkey capture (cancelled|timeout|superseded)/.exec(message)?.[1] ?? null;
  },
}));
vi.mock("@argon/core", () => ({
  logger: { debug() {}, info() {}, warn() {}, error() {} },
}));

import { useHotkeys, migrateLegacyBindings } from "@/store/ui/hotKeyStore";

const KEYBOARD = 0;
const VK = { CTRL_R: 0xa3, M: 0x4d, K: 0x4b, F5: 0x74 };
const kb = (...codes: number[]) => ({ buttons: codes.map((code) => ({ device: KEYBOARD, code })) });

/** The host's last binding list, by action id. */
const lastPushed = () => {
  const calls = host.setBindings.mock.calls;
  const list = calls[calls.length - 1]?.[0] as { id: string }[] | undefined;
  return (list ?? []).map((b) => b.id).sort();
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  host.available = true;
  setActivePinia(createPinia());
});

describe("migration from the old store", () => {
  const legacy = (id: string, action: number, chord = kb(VK.F5)) => ({ id, chord, action, suppress: false, triggerCooldownMs: 20 });

  test("the toggle in hold mode was push-to-talk; every other old action keeps its meaning", () => {
    const migrated = migrateLegacyBindings([
      legacy("key.microphone.toggle", 1, kb(VK.CTRL_R)),
      legacy("key.microphone.on", 0, kb(VK.K)),
      legacy("key.microphone.off", 0, kb(VK.M)),
      legacy("key.sound.toggle", 2),
    ]);
    expect(migrated["voice.pushToTalk"]).toEqual(kb(VK.CTRL_R));
    expect(migrated["voice.unmute"]).toEqual(kb(VK.K));
    expect(migrated["voice.mute"]).toEqual(kb(VK.M));
    expect(migrated["voice.toggleDeafen"]).toEqual(kb(VK.F5));
    expect(migrated["voice.toggleMute"]).toBeUndefined();
  });

  test("the toggle in trigger or toggle mode becomes toggle microphone", () => {
    expect(migrateLegacyBindings([legacy("key.microphone.toggle", 0)])["voice.toggleMute"]).toEqual(kb(VK.F5));
    expect(migrateLegacyBindings([legacy("key.microphone.toggle", 2)])["voice.toggleMute"]).toEqual(kb(VK.F5));
  });

  test("empty chords and unknown actions are dropped", () => {
    const migrated = migrateLegacyBindings([
      legacy("key.microphone.toggle", 1, { buttons: [] }),
      legacy("key.something.else", 0),
    ]);
    expect(migrated).toEqual({});
  });

  test("the store reads the old Map once, when nothing new is stored yet", () => {
    localStorage.setItem(
      "HotKeyAction_v2",
      superjson.stringify(new Map([["key.microphone.toggle", legacy("key.microphone.toggle", 1, kb(VK.CTRL_R))]])),
    );
    const store = useHotkeys();
    expect(store.chordOf("voice.pushToTalk")).toEqual(kb(VK.CTRL_R));
    expect(lastPushed()).toEqual(["voice.pushToTalk"]);
  });

  test("new bindings win over the old store", () => {
    localStorage.setItem("hotkeys.bindings.v3", superjson.stringify({ "voice.toggleMute": kb(VK.M) }));
    localStorage.setItem(
      "HotKeyAction_v2",
      superjson.stringify(new Map([["key.microphone.toggle", legacy("key.microphone.toggle", 1)]])),
    );
    const store = useHotkeys();
    expect(store.isBound("voice.pushToTalk")).toBe(false);
    expect(store.chordOf("voice.toggleMute")).toEqual(kb(VK.M));
  });
});

describe("keeping the host in sync", () => {
  test("pushes every bound action, and nothing while the master switch is off", async () => {
    const store = useHotkeys();
    expect(lastPushed()).toEqual([]);

    store.setBinding("voice.pushToTalk", kb(VK.CTRL_R));
    store.setBinding("call.leave", kb(VK.F5));
    await nextTick();
    expect(lastPushed()).toEqual(["call.leave", "voice.pushToTalk"]);

    store.options.enabled = false;
    await nextTick();
    expect(lastPushed()).toEqual([]);

    store.options.enabled = true;
    await nextTick();
    expect(lastPushed()).toEqual(["call.leave", "voice.pushToTalk"]);
  });

  test("clearing a key removes it from the host", async () => {
    const store = useHotkeys();
    store.setBinding("voice.pushToTalk", kb(VK.CTRL_R));
    await nextTick();
    store.clearBinding("voice.pushToTalk");
    await nextTick();
    expect(lastPushed()).toEqual([]);
    expect(store.isBound("voice.pushToTalk")).toBe(false);
  });

  test("options saved before a new option existed get its default", () => {
    localStorage.setItem("hotkeys.options.v3", superjson.stringify({ enabled: false }));
    const store = useHotkeys();
    expect(store.options.enabled).toBe(false);
    expect(store.options.pttReleaseDelayMs).toBe(0);
    expect(store.options.pttRadioBeeps).toBe(false);
  });

  test("does nothing on the web", () => {
    host.available = false;
    const store = useHotkeys();
    store.setBinding("voice.pushToTalk", kb(VK.CTRL_R));
    expect(host.setBindings).not.toHaveBeenCalled();
    expect(host.onFired).not.toHaveBeenCalled();
  });
});

describe("events", () => {
  test("host events reach the action's subscribers, and only theirs", () => {
    const store = useHotkeys();
    const fire = host.onFired.mock.calls[0][0];
    const ptt: string[] = [];
    const mute: string[] = [];
    store.onAction("voice.pushToTalk", (e) => ptt.push(e.phase));
    store.onAction("voice.toggleMute", (e) => mute.push(e.phase));

    fire("voice.pushToTalk", "down");
    fire("voice.pushToTalk", "up");
    fire("voice.toggleMute", "down");
    fire("something.unknown", "down");

    expect(ptt).toEqual(["down", "up"]);
    expect(mute).toEqual(["down"]);
  });

  test("an unsubscribed action no longer hears anything", () => {
    const store = useHotkeys();
    const fire = host.onFired.mock.calls[0][0];
    const seen: string[] = [];
    const sub = store.onAction("call.leave", (e) => seen.push(e.phase));
    fire("call.leave", "down");
    sub.unsubscribe();
    fire("call.leave", "down");
    expect(seen).toEqual(["down"]);
  });
});

describe("recording a key", () => {
  test("binds what the host captured", async () => {
    const store = useHotkeys();
    host.captureOnce.mockResolvedValueOnce(kb(VK.M, VK.CTRL_R));
    const pending = store.captureFor("voice.toggleMute");
    expect(store.capturingFor).toBe("voice.toggleMute");
    expect(await pending).toBe("bound");
    expect(store.capturingFor).toBeNull();
    // Stored in display order: modifiers first.
    expect(store.chordOf("voice.toggleMute")).toEqual(kb(VK.CTRL_R, VK.M));
  });

  test("Esc or a timeout leaves the old key alone and the field free", async () => {
    const store = useHotkeys();
    store.setBinding("voice.toggleMute", kb(VK.M));
    host.captureOnce.mockRejectedValueOnce(
      new Error("Error invoking remote method 'argon:rpc': HotkeyCaptureError: hotkey capture cancelled"),
    );
    expect(await store.captureFor("voice.toggleMute")).toBe("cancelled");
    expect(store.chordOf("voice.toggleMute")).toEqual(kb(VK.M));
    expect(store.capturingFor).toBeNull();
    expect(store.captureError).toBeNull();
  });

  test("a host that cannot record reports the failure", async () => {
    const store = useHotkeys();
    host.captureOnce.mockRejectedValueOnce(new Error("hotkeys are not running"));
    expect(await store.captureFor("voice.toggleMute")).toBe("failed");
    expect(store.captureError).toContain("not running");
  });

  test("a second recording takes the field over from the first", async () => {
    const store = useHotkeys();
    let rejectFirst!: (e: Error) => void;
    host.captureOnce
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(kb(VK.K));
    const first = store.captureFor("voice.mute");
    const second = store.captureFor("voice.unmute");
    expect(store.capturingFor).toBe("voice.unmute");
    rejectFirst(new Error("hotkey capture superseded"));
    expect(await first).toBe("cancelled");
    expect(await second).toBe("bound");
    expect(store.capturingFor).toBeNull();
    expect(store.isBound("voice.mute")).toBe(false);
    expect(store.chordOf("voice.unmute")).toEqual(kb(VK.K));
  });
});

describe("conflicts", () => {
  test("two actions on the same keys see each other", () => {
    const store = useHotkeys();
    store.setBinding("voice.toggleMute", kb(VK.CTRL_R, VK.M));
    store.setBinding("call.leave", kb(VK.M, VK.CTRL_R));
    store.setBinding("voice.deafen", kb(VK.M));
    expect(store.conflictsOf("voice.toggleMute")).toEqual(["call.leave"]);
    expect(store.conflictsOf("call.leave")).toEqual(["voice.toggleMute"]);
    expect(store.conflictsOf("voice.deafen")).toEqual([]);
    expect(store.conflictsOf("voice.pushToTalk")).toEqual([]);
  });
});
