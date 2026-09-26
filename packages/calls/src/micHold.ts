// @argon/calls - Shared microphone hold
//
// Push-to-talk and the radio key both open the microphone while held, and they can be held at
// the same time. One registry, keyed by holder, opens the mic on the first hold and closes it
// again once the last hold is gone, so releasing one key never cuts off the other. Where the
// mic goes afterwards is the holder's call: push-to-talk always leaves it muted (a tap in
// voice-activity mode ends muted, as it always did), the radio puts back what it found. A mic
// the user closed during the hold stays closed either way.

import type { ICallSystemState } from "./types";

export interface MicHoldOptions {
  /** After the last release: the mic as it was before the hold (default), or muted (push-to-talk). */
  restoreTo?: "previous" | "muted";
}

export interface MicHold {
  /** Open the microphone for `id`. Idempotent per holder. */
  acquire(id: string, opts?: MicHoldOptions): Promise<unknown> | void;
  /** Drop `id`'s hold; the rest state returns with the last release. */
  release(id: string): Promise<unknown> | void;
  /** Whether anyone holds the microphone open. */
  readonly held: boolean;
  holders(): ReadonlySet<string>;
}

export function createMicHold(sys: Pick<ICallSystemState, "microphoneMuted" | "setMicrophoneMuted">): MicHold {
  const holders = new Set<string>();
  let restoreMuted = false;

  return {
    acquire(id, opts) {
      if (holders.has(id)) return;
      const first = holders.size === 0;
      holders.add(id);
      const wantsMuted = opts?.restoreTo === "muted";
      // One push-to-talk hold anywhere in the overlap means "muted afterwards".
      if (first) restoreMuted = wantsMuted || sys.microphoneMuted;
      else if (wantsMuted) restoreMuted = true;
      if (!first) return;
      return sys.setMicrophoneMuted(false, { silent: true });
    },
    release(id) {
      if (!holders.delete(id) || holders.size > 0) return;
      // Only what the hold opened is put back: a mic the user closed meanwhile (or a moderator's
      // lock kept closed) is left alone.
      if (sys.microphoneMuted) return;
      return sys.setMicrophoneMuted(restoreMuted, { silent: true });
    },
    get held() {
      return holders.size > 0;
    },
    holders: () => holders,
  };
}
