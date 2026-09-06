/**
 * The quick device switcher behind the chevrons in the call controls.
 *
 * Microphone, speakers and camera share this; what it guards is the part that is easy
 * to get subtly wrong in each copy: the list is fetched when the menu opens (not at
 * mount, when labels are still blank), a pick closes the menu before the switch lands,
 * and a failed or slow switch never leaves the menu wedged.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { nextTick } from "vue";

const audio = vi.hoisted(() => ({
  enumerateDevicesByKind: vi.fn(async (_kind: string): Promise<{ deviceId: string; label: string }[]> => []),
}));
vi.mock("@/lib/audio/AudioManager", () => ({ audio }));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));

import { useDeviceMenu } from "@/composables/useDeviceMenu";

const device = (deviceId: string, label = deviceId) => ({ deviceId, label });

/** A promise whose settlement the test controls. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  audio.enumerateDevicesByKind.mockReset();
  audio.enumerateDevicesByKind.mockResolvedValue([]);
});

describe("listing", () => {
  test("nothing is enumerated until the menu opens, and then only that kind", async () => {
    audio.enumerateDevicesByKind.mockResolvedValue([device("spk-1"), device("spk-2")]);
    const menu = useDeviceMenu("audiooutput", async () => {});
    await nextTick();
    expect(audio.enumerateDevicesByKind).not.toHaveBeenCalled();
    expect(menu.devices).toEqual([]);

    menu.open = true;
    await nextTick();
    await nextTick();

    expect(audio.enumerateDevicesByKind).toHaveBeenCalledTimes(1);
    expect(audio.enumerateDevicesByKind).toHaveBeenCalledWith("audiooutput");
    expect(menu.devices.map((d) => d.deviceId)).toEqual(["spk-1", "spk-2"]);
  });

  test("every open refreshes the list, so an unplugged device disappears", async () => {
    audio.enumerateDevicesByKind.mockResolvedValue([device("spk-1"), device("spk-2")]);
    const menu = useDeviceMenu("audiooutput", async () => {});
    menu.open = true;
    await nextTick();
    await nextTick();
    expect(menu.devices).toHaveLength(2);

    menu.open = false;
    await nextTick();
    audio.enumerateDevicesByKind.mockResolvedValue([device("spk-1")]);
    menu.open = true;
    await nextTick();
    await nextTick();

    expect(audio.enumerateDevicesByKind).toHaveBeenCalledTimes(2);
    expect(menu.devices.map((d) => d.deviceId)).toEqual(["spk-1"]);
  });

  test("closing the menu does not enumerate", async () => {
    const menu = useDeviceMenu("audioinput", async () => {});
    menu.open = true;
    await nextTick();
    menu.open = false;
    await nextTick();
    expect(audio.enumerateDevicesByKind).toHaveBeenCalledTimes(1);
  });

  test("an enumeration failure is an empty list, not a crash", async () => {
    audio.enumerateDevicesByKind.mockRejectedValue(new Error("NotAllowedError"));
    const menu = useDeviceMenu("videoinput", async () => {});
    menu.open = true;
    await nextTick();
    await nextTick();
    expect(menu.devices).toEqual([]);
    expect(menu.open).toBe(true);
  });
});

describe("picking", () => {
  test("closes the menu, applies the device once, and reports switching while it lands", async () => {
    const pending = deferred();
    const apply = vi.fn(() => pending.promise);
    const menu = useDeviceMenu("audiooutput", apply);
    menu.open = true;

    const done = menu.pick("spk-2");
    expect(menu.open).toBe(false);
    expect(menu.switching).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("spk-2");

    pending.resolve();
    await done;
    expect(menu.switching).toBe(false);
  });

  test("a second pick while the first is still applying is ignored", async () => {
    const pending = deferred();
    const apply = vi.fn(() => pending.promise);
    const menu = useDeviceMenu("audiooutput", apply);

    const first = menu.pick("spk-1");
    await menu.pick("spk-2");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("spk-1");

    pending.resolve();
    await first;

    // Once it has landed, the next pick goes through.
    await menu.pick("spk-2");
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith("spk-2");
  });

  test("a failed switch resets the menu and does not escape to the caller", async () => {
    const apply = vi.fn(async () => {
      throw new Error("setSinkId failed");
    });
    const menu = useDeviceMenu("audiooutput", apply);

    await expect(menu.pick("spk-1")).resolves.toBeUndefined();
    expect(menu.switching).toBe(false);

    await menu.pick("spk-1");
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
