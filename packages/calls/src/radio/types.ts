// @argon/calls - Radio (broadcast channel) state shared by the session and the UI

import type { BroadcastSettings } from "@argon/glue";

/** A radio participant audible in my room: who, and which broadcast channel they speak from. */
export interface RadioSpeaker {
  userId: string;
  /** The `argon.broadcast` attribute; null when the token carried none. */
  hqChannelId: string | null;
}

export type RadioUnavailableReason =
  | "not_in_channel"
  | "not_a_broadcast_channel"
  | "insufficient_permissions"
  | "server_restricted"
  | "sfu_unavailable"
  | "connecting"
  | "error";

export interface RadioState {
  /** Radio room connected, key usable. */
  available: boolean;
  connecting: boolean;
  /** Key held, radio track unmuted. */
  transmitting: boolean;
  /** userId of another HQ member currently on air (`argon.radio=on`), else null. */
  busyBy: string | null;
  unavailableReason: RadioUnavailableReason | null;
  /** From GetBroadcastLinks; null until the links are issued. */
  settings: BroadcastSettings | null;
  /** Listener side: `bc:*` participants in my room currently audible. */
  onAir: RadioSpeaker[];
}

export function initialRadioState(): RadioState {
  return {
    available: false,
    connecting: false,
    transmitting: false,
    busyBy: null,
    unavailableReason: null,
    settings: null,
    onAir: [],
  };
}
