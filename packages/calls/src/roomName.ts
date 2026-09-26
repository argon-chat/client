// @argon/calls - Voice room names
//
// A voice channel's LiveKit room is `{spaceId}/{channelId}`; a broadcast channel's radio room is
// `radio/{spaceId}/{channelId}`. The SFU names the room it moved us to this way.

export interface VoiceRoomName {
  spaceId: string;
  channelId: string;
}

/** `"{spaceId}/{channelId}"` -> its parts; null for a radio room or anything else. */
export function parseVoiceRoomName(name: string): VoiceRoomName | null {
  const parts = name.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { spaceId: parts[0], channelId: parts[1] };
}
