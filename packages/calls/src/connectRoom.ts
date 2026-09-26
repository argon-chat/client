// @argon/calls - Connecting a LiveKit room through the SFU's ICE servers
//
// Shared by the call room and the radio room: the TURN servers the server hands out are probed
// in parallel (a real data transfer over a relay-only pair, 2 s each) and only the live ones are
// given to the connection, so ICE never waits on a dead relay.

import type { Room, RoomConnectOptions } from "livekit-client";
import { logger } from "@argon/core";
import type { RtcEndpoint } from "@argon/glue";

export interface TurnProbeSummary {
  total: number;
  alive: number;
}

export interface ConnectRoomOptions {
  connect?: RoomConnectOptions;
  /** Called once the TURN servers were probed, when there were any to probe. */
  onTurnProbed?(summary: TurnProbeSummary): void;
  /** Log prefix: "[CALL]" for the call room, "[RADIO]" for the radio. */
  tag?: string;
}

function isStun(url: string) {
  return url.startsWith("stun:");
}

function isTurn(url: string) {
  return url.startsWith("turn:");
}

function normalizeUrls(urls: string | string[]) {
  return Array.isArray(urls) ? urls : [urls];
}

export async function connectRoom(room: Room, rts: RtcEndpoint, token: string, opts: ConnectRoomOptions = {}) {
  const tag = opts.tag ?? "[CALL]";
  const stunServers: RTCIceServer[] = rts.ices.flatMap((x) =>
    normalizeUrls(x.endpoint)
      .filter(isStun)
      .map((url) => ({ urls: url })),
  );

  // Check TURN servers aggressively in parallel
  const turnServers: RTCIceServer[] = [];
  const turnConfigs = rts.ices.filter((x) => normalizeUrls(x.endpoint).some(isTurn));

  if (turnConfigs.length > 0) {
    logger.info(`${tag} Testing ${turnConfigs.length} TURN servers...`);

    const probePromises = turnConfigs.flatMap((turnConfig) => {
      const turnUrls = normalizeUrls(turnConfig.endpoint).filter(isTurn);
      return turnUrls.map(async (turnUrl) => {
        const isAlive = await probeTurn(
          {
            endpoint: turnUrl,
            username: turnConfig.username || "",
            password: turnConfig.password || "",
          },
          2000, // 2s timeout for real data transfer test
        );

        if (isAlive) {
          logger.info(`${tag} ✓ TURN OK: ${turnUrl}`);
          return {
            urls: turnUrl,
            username: turnConfig.username,
            credential: turnConfig.password,
          };
        } else {
          logger.warn(`${tag} ✗ TURN DEAD: ${turnUrl}`);
          return null;
        }
      });
    });

    const results = await Promise.allSettled(probePromises);
    results.forEach((result) => {
      if (result.status === "fulfilled" && result.value) {
        turnServers.push(result.value);
      }
    });

    logger.info(`${tag} TURN results: ${turnServers.length}/${turnConfigs.length} alive`);
    opts.onTurnProbed?.({ total: turnConfigs.length, alive: turnServers.length });
  }

  const allIceServers = [...stunServers, ...turnServers];

  logger.warn(`${tag} LiveKit connecting...`, rts.endpoint, {
    stun: stunServers.length,
    turn: turnServers.length,
  });

  await room.connect(rts.endpoint, token, {
    ...opts.connect,
    rtcConfig: {
      iceServers: allIceServers,
      iceCandidatePoolSize: 10,
      iceTransportPolicy: "all",
    },
  });
}

export async function probeTurn(
  turn: {
    endpoint: string;
    username: string;
    password: string;
  },
  timeoutMs = 3000,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let pc1: RTCPeerConnection | null = null;
    let pc2: RTCPeerConnection | null = null;
    let settled = false;
    let dataReceived = false;

    const cleanup = () => {
      if (pc1) pc1.close();
      if (pc2) pc2.close();
      pc1 = null;
      pc2 = null;
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(false);
    };

    const ok = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(true);
    };

    try {
      // Create two peer connections - both forced to use TURN relay only
      const config = {
        iceServers: [
          {
            urls: turn.endpoint,
            username: turn.username,
            credential: turn.password,
          },
        ],
        iceTransportPolicy: "relay" as RTCIceTransportPolicy,
      };

      pc1 = new RTCPeerConnection(config);
      pc2 = new RTCPeerConnection(config);

      // Setup data channel
      const dc = pc1.createDataChannel("probe");
      const testMessage = "ping";

      dc.onopen = () => {
        try {
          dc.send(testMessage);
        } catch (err) {
          fail();
        }
      };

      dc.onerror = fail;

      // Receive data on pc2
      pc2.ondatachannel = (event) => {
        const remoteChannel = event.channel;
        remoteChannel.onmessage = (msg) => {
          if (msg.data === testMessage) {
            dataReceived = true;
            ok(); // Real data transfer successful!
          }
        };
        remoteChannel.onerror = fail;
      };

      // ICE candidate exchange
      pc1.onicecandidate = (e) => {
        if (e.candidate) {
          pc2?.addIceCandidate(e.candidate).catch(fail);
        }
      };

      pc2.onicecandidate = (e) => {
        if (e.candidate) {
          pc1?.addIceCandidate(e.candidate).catch(fail);
        }
      };

      // Monitor connection state
      pc1.oniceconnectionstatechange = () => {
        if (pc1!.iceConnectionState === "failed") {
          fail();
        }
      };

      pc2.oniceconnectionstatechange = () => {
        if (pc2!.iceConnectionState === "failed") {
          fail();
        }
      };

      // Start signaling
      pc1
        .createOffer()
        .then((offer) => pc1!.setLocalDescription(offer))
        .then(() => pc2!.setRemoteDescription(pc1!.localDescription!))
        .then(() => pc2!.createAnswer())
        .then((answer) => pc2!.setLocalDescription(answer))
        .then(() => pc1!.setRemoteDescription(pc2!.localDescription!))
        .catch(fail);

      // Timeout
      setTimeout(() => {
        if (!settled) {
          if (!dataReceived) {
            fail();
          }
        }
      }, timeoutMs);
    } catch (err) {
      fail();
    }
  });
}
