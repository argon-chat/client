// @argon/calls - Radio participant identity
//
// A broadcaster is a second LiveKit participant, `bc:{userId}`, that the SFU forwards into the
// target rooms. Listeners recognise it by this prefix alone, never by participant kind. Plain
// strings so this stays importable without loading LiveKit (see "@argon/calls/radio-identity").

export const RADIO_IDENTITY_PREFIX = "bc:";

export function isRadioIdentity(identity: string): boolean {
  return identity.startsWith(RADIO_IDENTITY_PREFIX);
}

/** `"<uuid>"` -> `"bc:<uuid>"`. */
export function radioIdentity(userId: string): string {
  return `${RADIO_IDENTITY_PREFIX}${userId}`;
}

/** `"bc:<uuid>"` -> `"<uuid>"`; null for anything that is not a radio identity. */
export function radioUserId(identity: string): string | null {
  if (!isRadioIdentity(identity)) return null;
  const userId = identity.slice(RADIO_IDENTITY_PREFIX.length);
  return userId.length > 0 ? userId : null;
}

/**
 * Participant attributes. `kind`, `user` and `broadcast` are minted into the radio token by the
 * server; `onAir` is set by the client on its ordinary HQ participant while transmitting
 * (`"on"` / `"off"`), which is how other HQ members see "Busy".
 */
export const RADIO_ATTR = {
  kind: "argon.kind",
  user: "argon.user",
  broadcast: "argon.broadcast",
  onAir: "argon.radio",
} as const;

export const RADIO_KIND = "radio";
export const RADIO_ON_AIR = { on: "on", off: "off" } as const;
