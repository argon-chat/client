/**
 * The call controls: the speakers chevron next to the headphones button.
 *
 * The microphone button has long had a chevron that lists inputs for a quick switch;
 * this is the same thing for output devices. What these assert: the chevron exists and
 * is wired to output devices (not inputs), the list is fetched on open and marks the
 * current device, a pick switches and closes, and the deafen button itself stays a
 * plain one-click toggle. The microphone menu is checked alongside so the shared
 * switcher cannot cross the two kinds.
 *
 * The popover is replaced by a stub that shows its content only while open and toggles
 * on the trigger, which is all the real one contributes to these behaviours.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

// ── Fakes ────────────────────────────────────────────────────────────────────

const { audio, devicesByKind, sys, voice, callRights } = await vi.hoisted(async () => {
  const { ref, reactive } = await import("vue");
  const { vi } = await import("vitest");

  const devicesByKind: Record<string, { deviceId: string; label: string }[]> = {
    audioinput: [],
    audiooutput: [],
    videoinput: [],
  };
  const inputDevice = ref("mic-1");
  const outputDevice = ref("spk-1");

  const audio = {
    enumerateDevicesByKind: vi.fn(async (kind: string) => devicesByKind[kind] ?? []),
    getInputDevice: () => inputDevice,
    getOutputDevice: () => outputDevice,
    setInputDevice: vi.fn(async (id: string) => {
      inputDevice.value = id;
    }),
    setOutputDevice: vi.fn(async (id: string) => {
      outputDevice.value = id;
    }),
  };

  const sys = reactive({
    microphoneMuted: false,
    headphoneMuted: false,
    microphoneLocked: false,
    headphonesLocked: false,
    toggleMicrophoneMute: vi.fn(),
    toggleHeadphoneMute: vi.fn(),
  });

  const voice = reactive({
    isSharing: false,
    isCameraOn: false,
    systemAudioEnabled: false,
    lastShareOpts: null as null | Record<string, unknown>,
    adaptiveSettingPending: false,
    switchCamera: vi.fn(async () => {}),
    toggleCamera: vi.fn(),
    toggleSystemAudio: vi.fn(),
    stopScreenShare: vi.fn(),
    startScreenShare: vi.fn(async () => {}),
    switchScreenShare: vi.fn(async () => {}),
  });

  // What the channel we are in grants (useCallPermissions); all granted unless a test says not.
  const callRights = { canSpeak: ref(true), canVideo: ref(true), canStream: ref(true) };

  return { audio, devicesByKind, sys, voice, callRights };
});

vi.mock("@/lib/audio/AudioManager", () => ({ audio }));
vi.mock("@/store/system/systemStore", () => ({ useSystemStore: () => sys }));
vi.mock("@/store/media/unifiedCallStore", () => ({ useUnifiedCall: () => voice }));
vi.mock("@/composables/useCallPermissions", () => ({ useCallPermissions: () => callRights }));
vi.mock("@/store/features/playframeStore", () => ({
  usePlayFrameActivity: () => ({ isActive: false, openPicker() {} }),
}));
vi.mock("@/store/features/drawingSessionStore", () => ({
  useDrawingSession: () => ({ canDrawAnywhere: false, drawMode: false, toggleDrawMode() {} }),
}));
vi.mock("@/store/ui/preferenceStore", () => ({
  usePreference: () => ({ adaptiveVideoQuality: false, defaultVideoDevice: "" }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@/composables/useScreenShareSources", () => ({ qualityPresets: [] }));
vi.mock("@/components/ScreenSharePicker.vue", () => ({
  default: { name: "ScreenSharePicker", setup: () => () => null },
}));

// A popover that renders its content only while open and toggles on its trigger.
vi.mock("@argon/ui/popover", async () => {
  const { h, provide, inject, computed, defineComponent } = await import("vue");
  type Ctx = { isOpen: { value: boolean }; toggle: () => void };
  const KEY = Symbol("popover");
  return {
    Popover: defineComponent({
      name: "Popover",
      props: { open: { type: Boolean, default: false } },
      emits: ["update:open"],
      setup(props, { slots, emit }) {
        provide<Ctx>(KEY, {
          isOpen: computed(() => props.open),
          toggle: () => emit("update:open", !props.open),
        });
        return () => h("div", { class: "stub-popover" }, slots.default?.());
      },
    }),
    PopoverTrigger: defineComponent({
      name: "PopoverTrigger",
      setup(_, { slots }) {
        const ctx = inject<Ctx>(KEY)!;
        return () => h("div", { class: "stub-trigger", onClick: () => ctx.toggle() }, slots.default?.());
      },
    }),
    PopoverContent: defineComponent({
      name: "PopoverContent",
      setup(_, { slots }) {
        const ctx = inject<Ctx>(KEY)!;
        return () => (ctx.isOpen.value ? h("div", { class: "stub-content" }, slots.default?.()) : null);
      },
    }),
  };
});

import MediaControls from "@/components/MediaControls.vue";

// ── Helpers ──────────────────────────────────────────────────────────────────

let mounted: VueWrapper[] = [];

function render() {
  const w = mount(MediaControls, { props: { isConnected: true, isConnecting: false } });
  mounted.push(w);
  return w;
}

const split = (w: VueWrapper, name: "mic" | "speakers" | "camera" | "share") => w.find(`.ctrl-split--${name}`);

/** Open a split's menu and wait for its device list to land. */
async function openMenu(w: VueWrapper, name: "mic" | "speakers" | "camera") {
  await split(w, name).find(".ctrl-chevron").trigger("click");
  await nextTick();
  await nextTick();
  return split(w, name).find(".stub-content");
}

const rows = (menu: { findAll: VueWrapper["findAll"] }) => menu.findAll("button.device-row");
const rowNames = (menu: { findAll: VueWrapper["findAll"] }) => rows(menu).map((r) => r.find(".device-name").text());

beforeEach(() => {
  devicesByKind.audioinput = [
    { deviceId: "mic-1", label: "Built-in mic" },
    { deviceId: "mic-2", label: "USB mic" },
  ];
  devicesByKind.audiooutput = [
    { deviceId: "spk-1", label: "Built-in speakers" },
    { deviceId: "spk-2", label: "Headset" },
  ];
  devicesByKind.videoinput = [];
  audio.getInputDevice().value = "mic-1";
  audio.getOutputDevice().value = "spk-1";
  audio.enumerateDevicesByKind.mockClear();
  audio.setInputDevice.mockClear();
  audio.setOutputDevice.mockClear();
  sys.headphoneMuted = false;
  sys.microphoneMuted = false;
  sys.microphoneLocked = false;
  sys.headphonesLocked = false;
  sys.toggleHeadphoneMute.mockClear();
  sys.toggleMicrophoneMute.mockClear();
  callRights.canSpeak.value = true;
  callRights.canVideo.value = true;
  callRights.canStream.value = true;
  voice.isCameraOn = false;
  voice.isSharing = false;
  voice.toggleCamera.mockClear();
  voice.stopScreenShare.mockClear();
});

afterEach(() => {
  for (const w of mounted) w.unmount();
  mounted = [];
});

// ── Speakers ─────────────────────────────────────────────────────────────────

describe("the headphones button has a speakers chevron, like the microphone has", () => {
  test("a split with the deafen button and a chevron titled for switching speakers", () => {
    const w = render();
    const s = split(w, "speakers");
    expect(s.exists()).toBe(true);
    expect(s.find(".ctrl-btn").exists()).toBe(true);
    expect(s.find(".ctrl-chevron").attributes("title")).toBe("switch_speakers");
    // Same shape as the microphone split.
    expect(split(w, "mic").find(".ctrl-chevron").attributes("title")).toBe("switch_microphone");
  });

  test("the menu is closed by default and lists nothing until opened", () => {
    const w = render();
    expect(split(w, "speakers").find(".stub-content").exists()).toBe(false);
    expect(audio.enumerateDevicesByKind).not.toHaveBeenCalled();
  });

  test("opening lists output devices and marks the current one", async () => {
    const w = render();
    const menu = await openMenu(w, "speakers");

    expect(audio.enumerateDevicesByKind).toHaveBeenCalledTimes(1);
    expect(audio.enumerateDevicesByKind).toHaveBeenCalledWith("audiooutput");
    expect(menu.find(".ctrl-popover-title").text()).toBe("speakers");
    expect(rowNames(menu)).toEqual(["Built-in speakers", "Headset"]);

    const active = rows(menu).filter((r) => r.classes("active"));
    expect(active).toHaveLength(1);
    expect(active[0].find(".device-name").text()).toBe("Built-in speakers");
  });

  test("picking a device switches the output, closes the menu, and the mark follows", async () => {
    const w = render();
    let menu = await openMenu(w, "speakers");

    await rows(menu)[1].trigger("click");
    await nextTick();

    expect(audio.setOutputDevice).toHaveBeenCalledTimes(1);
    expect(audio.setOutputDevice).toHaveBeenCalledWith("spk-2");
    expect(audio.setInputDevice).not.toHaveBeenCalled();
    expect(split(w, "speakers").find(".stub-content").exists()).toBe(false);

    menu = await openMenu(w, "speakers");
    const active = rows(menu).filter((r) => r.classes("active"));
    expect(active.map((r) => r.find(".device-name").text())).toEqual(["Headset"]);
  });

  test("no output devices: an explanatory row instead of an empty menu", async () => {
    devicesByKind.audiooutput = [];
    const w = render();
    const menu = await openMenu(w, "speakers");
    expect(rows(menu)).toHaveLength(0);
    expect(menu.find(".device-row--empty").text()).toBe("no_speakers_found");
  });

  test("a device the browser will not name still gets a readable row", async () => {
    devicesByKind.audiooutput = [{ deviceId: "spk-x", label: "" }];
    const w = render();
    const menu = await openMenu(w, "speakers");
    expect(rowNames(menu)).toEqual(["speakers"]);
  });

  test("while a switch is still landing, the rows are disabled rather than double-firing", async () => {
    let finish!: () => void;
    audio.setOutputDevice.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          finish = res;
        }),
    );
    const w = render();
    let menu = await openMenu(w, "speakers");
    await rows(menu)[1].trigger("click");

    menu = await openMenu(w, "speakers");
    expect(rows(menu).every((r) => r.attributes("disabled") !== undefined)).toBe(true);

    finish();
    await nextTick();
    await nextTick();
    expect(rows(menu).every((r) => r.attributes("disabled") === undefined)).toBe(true);
    expect(audio.setOutputDevice).toHaveBeenCalledTimes(1);
  });

  test("the deafen button is still a one-click toggle and does not open the menu", async () => {
    const w = render();
    await split(w, "speakers").find(".ctrl-btn").trigger("click");
    expect(sys.toggleHeadphoneMute).toHaveBeenCalledTimes(1);
    expect(split(w, "speakers").find(".stub-content").exists()).toBe(false);
    expect(audio.enumerateDevicesByKind).not.toHaveBeenCalled();
  });

  test("deafened state is shown on the button, not on the chevron", async () => {
    const w = render();
    sys.headphoneMuted = true;
    await nextTick();
    expect(split(w, "speakers").find(".ctrl-btn").classes()).toContain("ctrl-btn--active");
    expect(split(w, "speakers").find(".ctrl-chevron").classes()).not.toContain("ctrl-btn--active");
  });
});

// ── Microphone, alongside ────────────────────────────────────────────────────

describe("the microphone chevron is unchanged by sharing the switcher", () => {
  test("it lists inputs, not outputs, and switches the input", async () => {
    const w = render();
    const menu = await openMenu(w, "mic");

    expect(audio.enumerateDevicesByKind).toHaveBeenCalledWith("audioinput");
    expect(audio.enumerateDevicesByKind).not.toHaveBeenCalledWith("audiooutput");
    expect(rowNames(menu)).toEqual(["Built-in mic", "USB mic"]);

    await rows(menu)[1].trigger("click");
    expect(audio.setInputDevice).toHaveBeenCalledWith("mic-2");
    expect(audio.setOutputDevice).not.toHaveBeenCalled();
  });

  test("the two menus keep separate open state", async () => {
    const w = render();
    await openMenu(w, "mic");
    expect(split(w, "mic").find(".stub-content").exists()).toBe(true);
    expect(split(w, "speakers").find(".stub-content").exists()).toBe(false);
  });
});

// ── A moderator's mute and deafen ────────────────────────────────────────────

describe("while a moderator holds the mute", () => {
  const mic = (w: VueWrapper) => w.find('[data-control="microphone"]');
  const headphones = (w: VueWrapper) => w.find('[data-control="headphones"]');

  test("the microphone button is locked, says why, and does not toggle", async () => {
    sys.microphoneMuted = true;
    sys.microphoneLocked = true;
    const w = render();

    expect(mic(w).classes()).toContain("ctrl-btn--locked");
    expect(mic(w).attributes("aria-disabled")).toBe("true");
    expect(mic(w).attributes("title")).toBe("voice_member_server_muted");

    await mic(w).trigger("click");
    expect(sys.toggleMicrophoneMute).not.toHaveBeenCalled();
    // A server mute is not a deafen: the headphones stay the user's.
    expect(headphones(w).classes()).not.toContain("ctrl-btn--locked");
  });

  test("a server deafen locks the headphones too", async () => {
    sys.microphoneLocked = true;
    sys.headphonesLocked = true;
    const w = render();

    expect(headphones(w).attributes("title")).toBe("voice_member_server_deafened");
    await headphones(w).trigger("click");
    expect(sys.toggleHeadphoneMute).not.toHaveBeenCalled();
  });

  test("once lifted, the buttons are ordinary toggles again", async () => {
    sys.microphoneLocked = true;
    const w = render();
    sys.microphoneLocked = false;
    await nextTick();

    expect(mic(w).classes()).not.toContain("ctrl-btn--locked");
    expect(mic(w).attributes("title")).toBeUndefined();
    await mic(w).trigger("click");
    expect(sys.toggleMicrophoneMute).toHaveBeenCalledTimes(1);
  });
});

describe("when the channel does not grant it", () => {
  const mic = (w: VueWrapper) => w.find('[data-control="microphone"]');
  const camera = (w: VueWrapper) => w.find('[data-control="camera"]');
  const share = (w: VueWrapper) => w.find('[data-control="screen-share"]');

  test("without Speak the microphone is locked, says why, and does not toggle", async () => {
    callRights.canSpeak.value = false;
    const w = render();

    expect(mic(w).classes()).toContain("ctrl-btn--forbidden");
    expect(mic(w).classes()).not.toContain("ctrl-btn--locked");
    expect(mic(w).attributes("aria-disabled")).toBe("true");
    expect(mic(w).attributes("title")).toBe("voice_no_speak_permission");

    await mic(w).trigger("click");
    expect(sys.toggleMicrophoneMute).not.toHaveBeenCalled();
  });

  test("a moderator's mute is still what the microphone says first", () => {
    callRights.canSpeak.value = false;
    sys.microphoneLocked = true;
    const w = render();

    expect(mic(w).classes()).toContain("ctrl-btn--locked");
    expect(mic(w).attributes("title")).toBe("voice_member_server_muted");
  });

  test("without Video the camera does not start, and says why", async () => {
    callRights.canVideo.value = false;
    const w = render();

    expect(camera(w).attributes("aria-disabled")).toBe("true");
    expect(camera(w).attributes("title")).toBe("voice_no_video_permission");
    await camera(w).trigger("click");
    expect(voice.toggleCamera).not.toHaveBeenCalled();
  });

  test("a camera left on when Video was taken away can still be turned off", async () => {
    callRights.canVideo.value = false;
    voice.isCameraOn = true;
    const w = render();

    await camera(w).trigger("click");
    expect(voice.toggleCamera).toHaveBeenCalledTimes(1);
  });

  test("without Stream the screen share does not open the picker, and says why", async () => {
    callRights.canStream.value = false;
    const w = render();

    expect(share(w).attributes("aria-disabled")).toBe("true");
    expect(share(w).attributes("title")).toBe("voice_no_stream_permission");
    await share(w).trigger("click");
    expect(voice.stopScreenShare).not.toHaveBeenCalled();
  });

  test("with everything granted nothing is locked", () => {
    const w = render();
    for (const b of [mic(w), camera(w), share(w)]) {
      expect(b.classes()).not.toContain("ctrl-btn--forbidden");
      expect(b.attributes("aria-disabled")).toBeUndefined();
    }
  });
});
