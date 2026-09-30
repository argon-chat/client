/**
 * Power saving: the window goes still when the machine has better things to spend on.
 *
 * Two things turn it on. A game the host's activity plugin sees running (Windows): the window is
 * behind the game, and every frame it draws is a frame taken from it. A battery at or below 20 %
 * and not charging (any laptop): animations, transitions and backdrop blur are what keep the GPU
 * awake in a chat window nobody is moving. Either way `power-save` goes on <html> — see
 * styles/power-save.css for what that stops — and expressions/settings.ts reads `powerSaveActive`
 * to hold stickers and custom emoji on their first frame.
 *
 * Deliberately store-free: module-level settings read this and a pinia store writes it, and a
 * store dependency here would close that into a cycle.
 */
import { computed, ref, watchEffect } from "vue";

export type PowerSaveReason = "battery" | "game";

/** At or below this the battery counts as low — where the OS savers draw their own line. */
export const LOW_BATTERY_LEVEL = 0.2;

/** The class on <html> while power saving is on. */
export const POWER_SAVE_CLASS = "power-save";

interface BatteryReading {
  /** 0..1, as the Battery Status API reports it. */
  level: number;
  charging: boolean;
}

interface Simulation {
  reason: PowerSaveReason;
  level: number;
}

const hostGameRunning = ref(false);
const sensor = ref<BatteryReading | null>(null);
// The console switch below: stands in for the sensors on a machine that has none.
const simulated = ref<Simulation | null>(null);

/** The battery as it is now, or null where there is none to read. */
export const battery = computed<BatteryReading | null>(() =>
  simulated.value?.reason === "battery" ? { level: simulated.value.level, charging: false } : sensor.value,
);

export const batteryLow = computed(() => {
  const reading = battery.value;
  return reading !== null && !reading.charging && reading.level <= LOW_BATTERY_LEVEL;
});

/** Whole percent for the indicator, or null without a battery. */
export const batteryPercent = computed(() => (battery.value ? Math.round(battery.value.level * 100) : null));

export const gameRunning = computed(() => hostGameRunning.value || simulated.value?.reason === "game");

export const powerSaveActive = computed(() => batteryLow.value || gameRunning.value);

/** Why it is on. Battery first: that is the one the user is shown. */
export const powerSaveReason = computed<PowerSaveReason | null>(() =>
  batteryLow.value ? "battery" : gameRunning.value ? "game" : null,
);

/** The activity store's word on whether the host sees a game — shared or not, the game is running. */
export function setGameRunning(running: boolean): void {
  hostGameRunning.value = running;
}

// The Battery Status API is Chromium's: Electron on both platforms and Chrome on the web have it,
// Firefox and Safari do not and simply never enter this mode. A desktop without a battery reports
// full and charging, which never trips the threshold.
interface BatteryManagerLike {
  readonly level: number;
  readonly charging: boolean;
  addEventListener(type: "levelchange" | "chargingchange", listener: () => void): void;
}

async function watchBattery(): Promise<void> {
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }).getBattery;
  if (typeof getBattery !== "function") return;
  let manager: BatteryManagerLike;
  try {
    manager = await getBattery.call(navigator);
  } catch {
    return;
  }
  const read = () => {
    sensor.value = { level: manager.level, charging: manager.charging };
  };
  manager.addEventListener("levelchange", read);
  manager.addEventListener("chargingchange", read);
  read();
}

let started = false;

/**
 * Keeps the <html> class in step, starts watching the battery and puts the console switch in place.
 * Idempotent: the app shell mounts once, but nothing here minds being asked twice.
 */
export function initPowerSaver(): void {
  if (started) return;
  started = true;
  watchEffect(() => {
    document.documentElement.classList.toggle(POWER_SAVE_CLASS, powerSaveActive.value);
  });
  void watchBattery();
  exposeConsoleSwitch();
}

function status() {
  return {
    active: powerSaveActive.value,
    reason: powerSaveReason.value,
    battery: battery.value,
    gameRunning: hostGameRunning.value,
    simulated: simulated.value,
  };
}

/**
 * `argonPowerSave` in the devtools console, for a desktop with no battery and no game to test with:
 *
 *   argonPowerSave.battery()      as if at 15 % and unplugged; pass a percentage for another level
 *   argonPowerSave.game()         as if the activity plugin had seen a game start
 *   argonPowerSave.reset()        back to the real sensors
 *   argonPowerSave.status()
 */
function exposeConsoleSwitch(): void {
  (window as any).argonPowerSave = {
    battery(percent = 15) {
      simulated.value = { reason: "battery", level: Math.min(Math.max(percent, 0), 100) / 100 };
      return status();
    },
    game() {
      simulated.value = { reason: "game", level: 1 };
      return status();
    },
    reset() {
      simulated.value = null;
      return status();
    },
    status,
  };
}
