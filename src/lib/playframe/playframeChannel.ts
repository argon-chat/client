/**
 * PlayFrame multiplayer transport over the LiveKit room data channel.
 *
 * Activity participants are already in the same LiveKit voice room, so all
 * PlayFrame peer traffic rides the SFU data channel (`publishData` /
 * `RoomEvent.DataReceived`) — no separate signaling backend, no P2P/TURN.
 * Two topics share one subscription:
 *   - `pf-signal` : WebRTC offer/answer/ice (legacy P2P path, still supported)
 *   - `pf-game`   : generic game messages (inputs / state / lobby coordination)
 *
 * Peer identity is the LiveKit participant identity (the Argon userId), which is
 * also used as the PlayFrame ephemeral id, so every client shares one namespace.
 */

import { RoomEvent, type Room, type RemoteParticipant } from "livekit-client";
import type { RtcSignalMessage } from "@argon/playframe";
import { logger } from "@argon/core";

const SIGNAL_TOPIC = "pf-signal";
const GAME_TOPIC = "pf-game";

interface SignalPacket {
  v: 1;
  from: string;
  to: string;
  signal: RtcSignalMessage;
}

interface GamePacket {
  v: 1;
  from: string;
  data: unknown;
}

export interface PlayFrameChannelHandlers {
  onSignal?: (from: string, signal: RtcSignalMessage) => void;
  onGameMessage?: (from: string, data: unknown) => void;
}

export interface PlayFrameChannel {
  /** Relay a WebRTC signal to a peer (legacy P2P path). */
  relaySignal(from: string, to: string, signal: RtcSignalMessage): Promise<boolean>;
  /** Send a game message to a peer (or broadcast when `to` is null). */
  sendGameMessage(from: string, to: string | null, data: unknown, reliable: boolean): void;
  dispose(): void;
}

export function createPlayFrameChannel(
  room: Room,
  handlers: PlayFrameChannelHandlers,
): PlayFrameChannel {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const handleData = (
    payload: Uint8Array,
    _participant?: RemoteParticipant,
    _kind?: unknown,
    topic?: string,
  ): void => {
    try {
      if (topic === SIGNAL_TOPIC) {
        const packet = JSON.parse(decoder.decode(payload)) as SignalPacket;
        if (packet?.v === 1 && packet.signal && packet.from) {
          handlers.onSignal?.(packet.from, packet.signal);
        }
      } else if (topic === GAME_TOPIC) {
        const packet = JSON.parse(decoder.decode(payload)) as GamePacket;
        if (packet?.v === 1 && packet.from) {
          handlers.onGameMessage?.(packet.from, packet.data);
        }
      }
    } catch (e) {
      logger.warn("[PlayFrame] Failed to decode data packet", e);
    }
  };

  room.on(RoomEvent.DataReceived, handleData);

  return {
    async relaySignal(from, to, signal): Promise<boolean> {
      try {
        const packet: SignalPacket = { v: 1, from, to, signal };
        await room.localParticipant.publishData(encoder.encode(JSON.stringify(packet)), {
          reliable: true,
          destinationIdentities: [to],
          topic: SIGNAL_TOPIC,
        });
        return true;
      } catch (e) {
        logger.warn("[PlayFrame] relaySignal failed", e);
        return false;
      }
    },

    sendGameMessage(from, to, data, reliable): void {
      const packet: GamePacket = { v: 1, from, data };
      room.localParticipant
        .publishData(encoder.encode(JSON.stringify(packet)), {
          reliable,
          destinationIdentities: to ? [to] : undefined,
          topic: GAME_TOPIC,
        })
        .catch((e) => logger.warn("[PlayFrame] sendGameMessage failed", e));
    },

    dispose(): void {
      room.off(RoomEvent.DataReceived, handleData);
    },
  };
}
