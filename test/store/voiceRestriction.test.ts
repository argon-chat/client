/**
 * A moderator's mute and deafen, as the system store enforces them.
 *
 * Every way of unmuting — the buttons, the taskbar, the hotkeys, push-to-talk — ends in
 * setMicrophoneMuted / setHeadphoneMuted, so the lock lives there and nowhere else. What these pin:
 * unmuting is refused while the restriction holds and muting never is, a restriction mutes
 * locally at once, and lifting it does not open anybody's microphone.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const tone = vi.hoisted(() => ({
  playMuteAllSound: vi.fn(),
  playUnmuteAllSound: vi.fn(),
}));

vi.mock("@/store/media/toneStore", () => ({ useTone: () => tone }));
vi.mock("@/store/realtime/busStore", async () => {
  const { Subject } = await import("rxjs");
  return {
    useBus: () => ({
      isReconnecting: false,
      resumed: new Subject<void>(),
      reconnected: new Subject<void>(),
      needFullResync: new Subject<void>(),
    }),
  };
});

import { useSystemStore } from "@/store/system/systemStore";

beforeEach(() => {
  setActivePinia(createPinia());
  tone.playMuteAllSound.mockClear();
  tone.playUnmuteAllSound.mockClear();
});

const recorded = (subject: { subscribe(next: (v: boolean) => void): unknown }) => {
  const seen: boolean[] = [];
  subject.subscribe((v) => seen.push(v));
  return seen;
};

describe("server mute", () => {
  test("mutes at once, quietly, and says so on the mute stream", () => {
    const sys = useSystemStore();
    const muted = recorded(sys.muteEvent);

    sys.setServerVoiceRestriction({ muted: true, deafened: false });

    expect(sys.microphoneMuted).toBe(true);
    expect(sys.microphoneLocked).toBe(true);
    expect(sys.headphonesLocked).toBe(false);
    expect(muted).toEqual([true]);
    expect(tone.playMuteAllSound).not.toHaveBeenCalled();
  });

  test("refuses every unmute: button, hotkey, push-to-talk", async () => {
    const sys = useSystemStore();
    sys.setServerVoiceRestriction({ muted: true, deafened: false });
    const muted = recorded(sys.muteEvent);

    await sys.toggleMicrophoneMute();
    await sys.setMicrophoneMuted(false);
    await sys.setMicrophoneMuted(false, { silent: true });

    expect(sys.microphoneMuted).toBe(true);
    expect(muted).toEqual([]);
    expect(tone.playUnmuteAllSound).not.toHaveBeenCalled();
  });

  test("undeafening does not bring the microphone back with it", async () => {
    const sys = useSystemStore();
    sys.setServerVoiceRestriction({ muted: true, deafened: false });

    await sys.setHeadphoneMuted(true);
    await sys.setHeadphoneMuted(false);

    expect(sys.headphoneMuted).toBe(false);
    expect(sys.microphoneMuted).toBe(true);
  });

  test("lifting it leaves the user muted until they unmute", async () => {
    const sys = useSystemStore();
    sys.setServerVoiceRestriction({ muted: true, deafened: false });

    sys.setServerVoiceRestriction({ muted: false, deafened: false });
    expect(sys.microphoneMuted).toBe(true);
    expect(sys.microphoneLocked).toBe(false);

    await sys.setMicrophoneMuted(false);
    expect(sys.microphoneMuted).toBe(false);
  });
});

describe("server deafen", () => {
  test("deafens at once and locks both controls", async () => {
    const sys = useSystemStore();
    const deafened = recorded(sys.muteHeadphoneEvent);

    sys.setServerVoiceRestriction({ muted: false, deafened: true });

    expect(sys.headphoneMuted).toBe(true);
    expect(sys.microphoneMuted).toBe(true);
    expect(sys.headphonesLocked).toBe(true);
    expect(sys.microphoneLocked).toBe(true);
    expect(deafened).toEqual([true]);

    await sys.toggleHeadphoneMute();
    await sys.setMicrophoneMuted(false);
    expect(sys.headphoneMuted).toBe(true);
    expect(sys.microphoneMuted).toBe(true);
  });

  test("lifting it leaves the user deafened until they undeafen", async () => {
    const sys = useSystemStore();
    sys.setServerVoiceRestriction({ muted: false, deafened: true });
    sys.setServerVoiceRestriction({ muted: false, deafened: false });

    expect(sys.headphoneMuted).toBe(true);
    await sys.setHeadphoneMuted(false);
    expect(sys.headphoneMuted).toBe(false);
  });
});

describe("without a restriction", () => {
  test("mute and unmute behave as before", async () => {
    const sys = useSystemStore();
    await sys.setMicrophoneMuted(true);
    await sys.setMicrophoneMuted(false);
    expect(sys.microphoneMuted).toBe(false);
    expect(tone.playMuteAllSound).toHaveBeenCalledTimes(1);
    expect(tone.playUnmuteAllSound).toHaveBeenCalledTimes(1);
  });

  test("muting is never refused, restriction or not", async () => {
    const sys = useSystemStore();
    sys.setServerVoiceRestriction({ muted: true, deafened: false });
    await sys.setHeadphoneMuted(true);
    expect(sys.headphoneMuted).toBe(true);
  });
});
