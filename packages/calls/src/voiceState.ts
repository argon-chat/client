// @argon/calls - Voice member flags
//
// The bits of the contract's ChannelMemberState. Plain numbers instead of the generated enum so
// this stays importable without loading @argon/glue at runtime; test/voiceState.test.ts pins them
// to the contract.

export const VoiceStateBits = {
  MUTED: 1 << 1,
  MUTED_BY_SERVER: 1 << 2,
  MUTED_HEADPHONES: 1 << 3,
  MUTED_HEADPHONES_BY_SERVER: 1 << 4,
  STREAMING: 1 << 5,
} as const;

/** The bits a client reports about itself. The *_BY_SERVER ones are set by moderation only. */
export const SELF_VOICE_STATE_MASK =
  VoiceStateBits.MUTED | VoiceStateBits.MUTED_HEADPHONES | VoiceStateBits.STREAMING;

export interface VoiceMemberFlags {
  muted: boolean;
  deafened: boolean;
  streaming: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
}

export function decodeVoiceState(state: number | null | undefined): VoiceMemberFlags {
  const s = Number(state ?? 0);
  return {
    muted: (s & VoiceStateBits.MUTED) !== 0,
    deafened: (s & VoiceStateBits.MUTED_HEADPHONES) !== 0,
    streaming: (s & VoiceStateBits.STREAMING) !== 0,
    serverMuted: (s & VoiceStateBits.MUTED_BY_SERVER) !== 0,
    serverDeafened: (s & VoiceStateBits.MUTED_HEADPHONES_BY_SERVER) !== 0,
  };
}

export function encodeSelfVoiceState(flags: { muted: boolean; deafened: boolean; streaming: boolean }): number {
  let s = 0;
  if (flags.muted) s |= VoiceStateBits.MUTED;
  if (flags.deafened) s |= VoiceStateBits.MUTED_HEADPHONES;
  if (flags.streaming) s |= VoiceStateBits.STREAMING;
  return s;
}

/** Replaces the moderation bits of `state`, leaving the member's own bits as they are. */
export function withServerVoiceState(state: number | null | undefined, muted: boolean, deafened: boolean): number {
  let s = Number(state ?? 0) & ~(VoiceStateBits.MUTED_BY_SERVER | VoiceStateBits.MUTED_HEADPHONES_BY_SERVER);
  if (muted) s |= VoiceStateBits.MUTED_BY_SERVER;
  if (deafened) s |= VoiceStateBits.MUTED_HEADPHONES_BY_SERVER;
  return s;
}
