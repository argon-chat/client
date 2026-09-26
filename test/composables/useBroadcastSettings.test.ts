/**
 * The broadcast settings patch is sparse: PatchBroadcastSettings leaves alone every key it does
 * not see, and reads `maxTransmitSeconds: null` as "no limit". So the form must send exactly the
 * keys that changed — nothing for an untouched field, null when the limit is switched off — and
 * the numbers must already be within the server's ranges.
 */

import { describe, test, expect } from "vitest";
import { BroadcastOverlap, SetBroadcastSettingsError, type BroadcastSettings } from "@argon/glue";
import {
  applyRemoteSettings,
  buildBroadcastPatch,
  broadcastErrorKey,
  clampTransmitSeconds,
  formFromSettings,
  isBroadcastFormDirty,
  limitOf,
  DEFAULT_MAX_TRANSMIT_SECONDS,
  type BroadcastField,
} from "@/composables/useBroadcastSettings";

const current: BroadcastSettings = {
  targets: ["a", "b"],
  overlap: BroadcastOverlap.MIX,
  duckingDb: -8,
  maxTransmitSeconds: 120,
  chirp: false,
};

describe("buildBroadcastPatch", () => {
  test("an untouched form patches nothing", () => {
    const form = formFromSettings(current);
    expect(buildBroadcastPatch(current, form)).toEqual({});
    expect(isBroadcastFormDirty(current, form)).toBe(false);
  });

  test("only the changed keys are sent", () => {
    const form = formFromSettings(current);
    form.chirp = true;
    form.overlap = BroadcastOverlap.LOCK;
    expect(buildBroadcastPatch(current, form)).toEqual({ chirp: true, overlap: BroadcastOverlap.LOCK });
  });

  test("targets compare as a set, and go out as a fresh list", () => {
    const form = formFromSettings(current);
    form.targets = ["b", "a"];
    expect(buildBroadcastPatch(current, form)).toEqual({});

    form.targets = ["a", "c"];
    const patch = buildBroadcastPatch(current, form);
    expect(patch).toEqual({ targets: ["a", "c"] });
    expect(patch.targets).not.toBe(form.targets);
  });

  test("switching the limit off sends null; switching it on sends the number", () => {
    const off = formFromSettings(current);
    off.limitOn = false;
    expect(buildBroadcastPatch(current, off)).toEqual({ maxTransmitSeconds: null });

    const unlimited: BroadcastSettings = { ...current, maxTransmitSeconds: null };
    const on = formFromSettings(unlimited);
    expect(on.limitOn).toBe(false);
    expect(on.maxTransmitSeconds).toBe(DEFAULT_MAX_TRANSMIT_SECONDS);
    on.limitOn = true;
    expect(buildBroadcastPatch(unlimited, on)).toEqual({ maxTransmitSeconds: DEFAULT_MAX_TRANSMIT_SECONDS });
  });

  test("a limit that is off is not dirtied by editing the hidden number", () => {
    const unlimited: BroadcastSettings = { ...current, maxTransmitSeconds: null };
    const form = formFromSettings(unlimited);
    form.maxTransmitSeconds = 300;
    expect(buildBroadcastPatch(unlimited, form)).toEqual({});
  });

  test("numbers are clamped to the server's ranges before they are compared", () => {
    const form = formFromSettings(current);
    form.maxTransmitSeconds = 5;
    form.duckingDb = -55.4;
    expect(buildBroadcastPatch(current, form)).toEqual({ maxTransmitSeconds: 10, duckingDb: -40 });

    form.maxTransmitSeconds = 99999;
    form.duckingDb = 3;
    expect(buildBroadcastPatch(current, form)).toEqual({ maxTransmitSeconds: 3600, duckingDb: 0 });

    // Clamping back onto the current value is not a change.
    form.maxTransmitSeconds = 120.4;
    form.duckingDb = -8.2;
    expect(buildBroadcastPatch(current, form)).toEqual({});
  });

  test("garbage in the number box falls back rather than sending NaN", () => {
    expect(clampTransmitSeconds(Number.NaN)).toBe(DEFAULT_MAX_TRANSMIT_SECONDS);
    expect(limitOf({ limitOn: true, maxTransmitSeconds: Number.NaN })).toBe(DEFAULT_MAX_TRANSMIT_SECONDS);
    expect(limitOf({ limitOn: false, maxTransmitSeconds: 42 })).toBeNull();
  });
});

describe("per-field dirtiness", () => {
  const touched = (...fields: BroadcastField[]) => new Set<BroadcastField>(fields);

  test("a remote change to an untouched field is not sent back", () => {
    // The user flipped chirp; meanwhile somebody else changed the ducking, and the form still
    // holds the old value for it.
    const form = formFromSettings(current);
    form.chirp = true;
    const remote: BroadcastSettings = { ...current, duckingDb: -20 };
    expect(buildBroadcastPatch(remote, form, touched("chirp"))).toEqual({ chirp: true });
    expect(isBroadcastFormDirty(remote, form, touched("chirp"))).toBe(true);
  });

  test("an untouched field that only looks different is not dirty", () => {
    const form = formFromSettings(current);
    const remote: BroadcastSettings = { ...current, targets: ["c"] };
    expect(buildBroadcastPatch(remote, form, touched())).toEqual({});
    expect(isBroadcastFormDirty(remote, form, touched())).toBe(false);
  });

  test("applyRemoteSettings writes the untouched fields and leaves the edited ones", () => {
    const form = formFromSettings(current);
    form.chirp = true;
    form.maxTransmitSeconds = 300;
    const remote: BroadcastSettings = { ...current, duckingDb: -20, chirp: true, maxTransmitSeconds: 60, targets: ["z"] };

    applyRemoteSettings(form, remote, touched("chirp", "limit"));

    expect(form.duckingDb).toBe(-20);
    expect(form.targets).toEqual(["z"]);
    expect(form.chirp).toBe(true);
    expect(form.maxTransmitSeconds).toBe(300);
    expect(form.limitOn).toBe(true);
    // After the merge the only difference left is the user's own limit.
    expect(buildBroadcastPatch(remote, form, touched("chirp", "limit"))).toEqual({ maxTransmitSeconds: 300 });
  });

  test("the limit switch and its number are one field", () => {
    const form = formFromSettings(current);
    const remote: BroadcastSettings = { ...current, maxTransmitSeconds: null };
    applyRemoteSettings(form, remote, touched());
    expect(form.limitOn).toBe(false);
    expect(form.maxTransmitSeconds).toBe(DEFAULT_MAX_TRANSMIT_SECONDS);

    form.limitOn = true;
    form.maxTransmitSeconds = 45;
    applyRemoteSettings(form, { ...current, maxTransmitSeconds: 90 }, touched("limit"));
    expect(form.limitOn).toBe(true);
    expect(form.maxTransmitSeconds).toBe(45);
  });

  test("without a touched set, everything is compared and everything is taken", () => {
    const form = formFromSettings(current);
    form.chirp = true;
    const remote: BroadcastSettings = { ...current, duckingDb: -20 };
    expect(buildBroadcastPatch(remote, form)).toEqual({ chirp: true, duckingDb: -8 });
    applyRemoteSettings(form, remote);
    expect(form.chirp).toBe(false);
    expect(form.duckingDb).toBe(-20);
  });
});

describe("broadcastErrorKey", () => {
  test("every server error has a message, and an unknown one falls back", () => {
    expect(broadcastErrorKey(SetBroadcastSettingsError.INSUFFICIENT_PERMISSIONS)).toBe("broadcast_error_insufficient_permissions");
    expect(broadcastErrorKey(SetBroadcastSettingsError.CHANNEL_IS_NOT_VOICE)).toBe("broadcast_error_not_voice");
    expect(broadcastErrorKey(SetBroadcastSettingsError.INVALID_TARGET)).toBe("broadcast_error_invalid_target");
    expect(broadcastErrorKey(SetBroadcastSettingsError.NOT_A_BROADCAST_CHANNEL)).toBe("broadcast_error_not_broadcast");
    expect(broadcastErrorKey(SetBroadcastSettingsError.NONE)).toBe("broadcast_error_unknown");
    expect(broadcastErrorKey(99 as SetBroadcastSettingsError)).toBe("broadcast_error_unknown");
  });
});
