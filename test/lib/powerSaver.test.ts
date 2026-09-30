/**
 * Power saving is on while a game runs or the battery is low and unplugged, off otherwise, and the
 * `power-save` class on <html> follows it — that class is what stops every animation, transition and
 * backdrop blur in the app (styles/power-save.css), so it is the thing to pin.
 *
 * The battery is read through the Battery Status API. A desktop reports full and charging and must
 * never enter this mode; the console switch is what stands in for a battery on such a machine.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";

type PowerSaver = typeof import("@/lib/powerSaver");

/** The API's BatteryManager, down to what the app reads: a level, a charging flag and their events. */
class FakeBattery extends EventTarget {
  level = 1;
  charging = true;

  set(level: number, charging: boolean) {
    const chargingChanged = charging !== this.charging;
    this.level = level;
    this.charging = charging;
    this.dispatchEvent(new Event("levelchange"));
    if (chargingChanged) this.dispatchEvent(new Event("chargingchange"));
  }
}

const html = () => document.documentElement.classList;

/** A fresh module, started as the app shell starts it, on a machine with `battery` (or none). */
async function started(battery: FakeBattery | null): Promise<PowerSaver> {
  if (battery) {
    Object.defineProperty(navigator, "getBattery", { value: () => Promise.resolve(battery), configurable: true });
  }
  vi.resetModules();
  const power = await import("@/lib/powerSaver");
  power.initPowerSaver();
  // The battery is read asynchronously; let it settle before anyone looks.
  await Promise.resolve();
  await nextTick();
  return power;
}

beforeEach(() => {
  html().remove("power-save");
});

afterEach(() => {
  delete (navigator as unknown as { getBattery?: unknown }).getBattery;
  delete (window as unknown as { argonPowerSave?: unknown }).argonPowerSave;
});

describe("the battery", () => {
  test("a desktop without one never enters power saving", async () => {
    const power = await started(null);
    expect(power.battery.value).toBeNull();
    expect(power.powerSaveActive.value).toBe(false);
    expect(html().contains("power-save")).toBe(false);
  });

  test("full and charging is not low", async () => {
    const power = await started(new FakeBattery());
    expect(power.batteryPercent.value).toBe(100);
    expect(power.batteryLow.value).toBe(false);
    expect(html().contains("power-save")).toBe(false);
  });

  test("20 % unplugged turns it on; plugging in turns it off", async () => {
    const battery = new FakeBattery();
    const power = await started(battery);

    battery.set(0.2, false);
    await nextTick();
    expect(power.batteryLow.value).toBe(true);
    expect(power.powerSaveReason.value).toBe("battery");
    expect(power.batteryPercent.value).toBe(20);
    expect(html().contains("power-save")).toBe(true);

    battery.set(0.2, true);
    await nextTick();
    expect(power.powerSaveActive.value).toBe(false);
    expect(html().contains("power-save")).toBe(false);
  });

  test("21 % unplugged is not yet low", async () => {
    const battery = new FakeBattery();
    const power = await started(battery);

    battery.set(0.21, false);
    await nextTick();
    expect(power.batteryLow.value).toBe(false);
    expect(html().contains("power-save")).toBe(false);
  });

  test("a machine whose battery cannot be read is left alone", async () => {
    Object.defineProperty(navigator, "getBattery", {
      value: () => Promise.reject(new Error("not allowed")),
      configurable: true,
    });
    vi.resetModules();
    const power = await import("@/lib/powerSaver");
    power.initPowerSaver();
    await Promise.resolve();
    await nextTick();
    expect(power.battery.value).toBeNull();
    expect(power.powerSaveActive.value).toBe(false);
  });
});

describe("a game", () => {
  test("turns it on while the host sees one, without any battery", async () => {
    const power = await started(null);

    power.setGameRunning(true);
    await nextTick();
    expect(power.powerSaveActive.value).toBe(true);
    expect(power.powerSaveReason.value).toBe("game");
    expect(html().contains("power-save")).toBe(true);

    power.setGameRunning(false);
    await nextTick();
    expect(power.powerSaveActive.value).toBe(false);
    expect(html().contains("power-save")).toBe(false);
  });

  test("a low battery is the reason shown when both hold", async () => {
    const battery = new FakeBattery();
    const power = await started(battery);
    power.setGameRunning(true);
    battery.set(0.1, false);
    await nextTick();
    expect(power.powerSaveReason.value).toBe("battery");
  });
});

describe("the console switch", () => {
  type Switch = {
    battery(percent?: number): unknown;
    game(): unknown;
    reset(): unknown;
    status(): { active: boolean; reason: string | null };
  };
  const consoleSwitch = () => (window as unknown as { argonPowerSave: Switch }).argonPowerSave;

  test("stands in for a low battery on a machine without one", async () => {
    const power = await started(null);

    consoleSwitch().battery();
    await nextTick();
    expect(power.powerSaveReason.value).toBe("battery");
    expect(power.batteryPercent.value).toBe(15);
    expect(html().contains("power-save")).toBe(true);

    consoleSwitch().battery(50);
    await nextTick();
    expect(power.powerSaveActive.value).toBe(false);

    consoleSwitch().game();
    await nextTick();
    expect(power.powerSaveReason.value).toBe("game");

    consoleSwitch().reset();
    await nextTick();
    expect(power.powerSaveActive.value).toBe(false);
    expect(power.battery.value).toBeNull();
    expect(html().contains("power-save")).toBe(false);
    expect(consoleSwitch().status()).toMatchObject({ active: false, reason: null });
  });

  test("does not hide the real sensors: a low battery still counts after a reset", async () => {
    const battery = new FakeBattery();
    const power = await started(battery);
    battery.set(0.05, false);
    consoleSwitch().reset();
    await nextTick();
    expect(power.powerSaveReason.value).toBe("battery");
    expect(power.batteryPercent.value).toBe(5);
  });
});
