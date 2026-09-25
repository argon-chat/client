import { ChannelType } from "@argon/glue";

// Channel types people talk in: joinable, with a live member list. Only Voice today; a
// broadcast-style voice channel is planned and belongs here when it lands.
const VOICE_LIKE: ReadonlySet<ChannelType> = new Set([ChannelType.Voice]);

export function isVoiceLikeChannel(type: ChannelType | null | undefined): boolean {
  return type !== null && type !== undefined && VOICE_LIKE.has(type);
}
