// @argon/calls - Shared microphone hold
//
// Push-to-talk and the radio key both open the microphone while held, and they can be held at
// the same time. One registry, keyed by holder, opens the mic on the first hold and puts it back
// the way it was once the last hold is gone, so releasing one key never cuts off the other.

import type { ICallSystemState } from "./types";

export interface MicHold {
  /** Open the microphone for `id`. Idempotent per holder. */
  acquire(id: string): Promise<unknown> | void;
  /** Drop `id`'s hold; the pre-hold mute state returns with the last release. */
  release(id: string): Promise<unknown> | void;
  /** Whether anyone holds the microphone open. */
  readonly held: boolean;
  holders(): ReadonlySet<string>;
}

export function createMicHold(sys: Pick<ICallSystemState, "microphoneMuted" | "setMicrophoneMuted">): MicHold {
  const holders = new Set<string>();
  let mutedBefore = false;

  return {
    acquire(id) {
      if (holders.has(id)) return;
      const first = holders.size === 0;
      holders.add(id);
      if (!first) return;
      mutedBefore = sys.microphoneMuted;
      return sys.setMicrophoneMuted(false, { silent: true });
    },
    release(id) {
      if (!holders.delete(id) || holders.size > 0) return;
      return sys.setMicrophoneMuted(mutedBefore, { silent: true });
    },
    get held() {
      return holders.size > 0;
    },
    holders: () => holders,
  };
}
