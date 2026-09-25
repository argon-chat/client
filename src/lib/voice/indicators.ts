import { decodeVoiceState } from "@argon/calls/voice-state";

/** What a voice member row or tile shows. */
export interface VoiceIndicators {
  micOff: boolean;
  /** The microphone is blocked by a moderator (server mute, or server deafen). */
  micByServer: boolean;
  headphonesOff: boolean;
  headphonesByServer: boolean;
  streaming: boolean;
}

/** State from the room we are connected to, which is ahead of the roster flags. */
export interface LiveVoiceState {
  /** Ourselves: the local state replaces our own bits instead of being merged with their echo. */
  self: boolean;
  muted: boolean;
  deafened: boolean;
  streaming: boolean;
  serverMuted?: boolean;
  serverDeafened?: boolean;
}

/**
 * Combines a member's roster flags (ChannelMemberState) with the live state of our own room.
 * Flags from another member reach us a moment after LiveKit's own mute, so the live state is
 * OR-ed in for them. Deafened counts as muted: a deafened member cannot be heard either.
 */
export function resolveVoiceIndicators(state: number | null | undefined, live?: LiveVoiceState | null): VoiceIndicators {
  const flags = decodeVoiceState(state);
  let { muted, deafened, streaming, serverMuted, serverDeafened } = flags;

  if (live) {
    if (live.self) {
      muted = live.muted;
      deafened = live.deafened;
      streaming = live.streaming;
    } else {
      muted ||= live.muted;
      deafened ||= live.deafened;
      streaming ||= live.streaming;
    }
    serverMuted ||= !!live.serverMuted;
    serverDeafened ||= !!live.serverDeafened;
  }

  return {
    micOff: muted || deafened || serverMuted || serverDeafened,
    micByServer: serverMuted || serverDeafened,
    headphonesOff: deafened || serverDeafened,
    headphonesByServer: serverDeafened,
    streaming,
  };
}
