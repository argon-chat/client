/**
 * connectRoom's TURN probe, and vue-native, where there is none: no raw RTCPeerConnection exists
 * there (its LiveKit is native), so the TURN servers go to the connection unprobed instead of all
 * being reported dead.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { Room } from "livekit-client";
import type { RtcEndpoint } from "@argon/glue";
import { connectRoom } from "../src/connectRoom";

const rts = {
  endpoint: "wss://sfu.test",
  ices: [
    { endpoint: "stun:stun.test:3478", username: "", password: "" },
    { endpoint: "turn:turn.test:3478", username: "u", password: "p" },
  ],
} as unknown as RtcEndpoint;

function fakeRoom() {
  const connect = vi.fn(async () => {});
  return { room: { connect } as unknown as Room, connect };
}

let constructed = 0;

beforeEach(() => {
  constructed = 0;
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      constructor() {
        constructed++;
        throw new Error("no WebRTC in this test");
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connectRoom", () => {
  test("in a browser the TURN servers are probed, and a dead one is left out", async () => {
    const { room, connect } = fakeRoom();
    const onTurnProbed = vi.fn();
    await connectRoom(room, rts, "token", { onTurnProbed });

    expect(constructed).toBeGreaterThan(0);
    expect(onTurnProbed).toHaveBeenCalledWith({ total: 1, alive: 0 });
    const [, , options] = connect.mock.calls[0] as unknown as [string, string, { rtcConfig: RTCConfiguration }];
    expect(options.rtcConfig.iceServers).toEqual([{ urls: "stun:stun.test:3478" }]);
  });

  test("under vue-native they are not probed, and handed on as they are", async () => {
    vi.stubGlobal("isVn", true);
    const { room, connect } = fakeRoom();
    const onTurnProbed = vi.fn();
    await connectRoom(room, rts, "token", { onTurnProbed });

    expect(constructed).toBe(0);
    expect(onTurnProbed).not.toHaveBeenCalled();
    const [, , options] = connect.mock.calls[0] as unknown as [string, string, { rtcConfig: RTCConfiguration }];
    expect(options.rtcConfig.iceServers).toEqual([
      { urls: "stun:stun.test:3478" },
      { urls: "turn:turn.test:3478", username: "u", credential: "p" },
    ]);
  });
});
