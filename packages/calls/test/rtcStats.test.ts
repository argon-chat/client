/**
 * WebRTC stats parsing.
 *
 * A getStats() report is a flat bag of entries whose shape varies by browser and by
 * what is currently being sent. The parser's job is to pick the right entry per slot
 * and to leave a slot null rather than guess — the call diagnostics read these fields
 * directly, and a wrong pick shows the user another participant's numbers.
 */

import { describe, test, expect } from "vitest";
import { parseRtcStats } from "../src/rtcStats";

/** getStats() yields [id, entry] pairs; the parser takes them as an array. */
const report = (...entries: Record<string, unknown>[]) =>
  entries.map((e, i) => [`id-${i}`, e] as [string, unknown]);

describe("parseRtcStats", () => {
  test("an empty report leaves every slot null", () => {
    expect(parseRtcStats([])).toEqual({
      inboundAudio: null,
      inboundVideo: null,
      outboundAudio: null,
      outboundVideo: null,
      candidatePair: null,
      codec: null,
      transport: null,
      playout: null,
    });
  });

  test("splits inbound entries by media kind", () => {
    const audio = { type: "inbound-rtp", kind: "audio", packetsLost: 3 };
    const video = { type: "inbound-rtp", kind: "video", frameWidth: 1920 };

    const parsed = parseRtcStats(report(audio, video));

    expect(parsed.inboundAudio).toBe(audio);
    expect(parsed.inboundVideo).toBe(video);
  });

  test("remote-outbound entries land in the outbound slots", () => {
    const audio = { type: "remote-outbound-rtp", kind: "audio" };
    const video = { type: "remote-outbound-rtp", kind: "video" };

    const parsed = parseRtcStats(report(audio, video));

    expect(parsed.outboundAudio).toBe(audio);
    expect(parsed.outboundVideo).toBe(video);
  });

  test("only the succeeded candidate pair counts", () => {
    // A connection accumulates failed and in-progress pairs; picking one of those
    // reports the round-trip time of a route that was never used.
    const failed = { type: "candidate-pair", state: "failed", currentRoundTripTime: 9 };
    const waiting = { type: "candidate-pair", state: "in-progress", currentRoundTripTime: 8 };
    const good = { type: "candidate-pair", state: "succeeded", currentRoundTripTime: 0.02 };

    const parsed = parseRtcStats(report(failed, waiting, good));

    expect(parsed.candidatePair).toBe(good);
  });

  test("a report with no succeeded pair reports none", () => {
    const parsed = parseRtcStats(report({ type: "candidate-pair", state: "failed" }));
    expect(parsed.candidatePair).toBeNull();
  });

  test("picks up transport, codec and playout entries", () => {
    const transport = { type: "transport", packetsSent: 10 };
    const codec = { type: "codec", mimeType: "video/VP9" };
    const playout = { type: "media-playout", totalPlayoutDelay: 0.1 };

    const parsed = parseRtcStats(report(transport, codec, playout));

    expect(parsed.transport).toBe(transport);
    expect(parsed.codec).toBe(codec);
    expect(parsed.playout).toBe(playout);
  });

  test("unknown entry types are ignored rather than throwing", () => {
    const parsed = parseRtcStats(
      report(
        { type: "peer-connection" },
        { type: "certificate" },
        { type: "data-channel" },
        { type: "inbound-rtp", kind: "audio" },
      ),
    );

    expect(parsed.inboundAudio).not.toBeNull();
    expect(parsed.transport).toBeNull();
  });

  test("an inbound entry with no kind fills neither audio nor video", () => {
    const parsed = parseRtcStats(report({ type: "inbound-rtp" }));
    expect(parsed.inboundAudio).toBeNull();
    expect(parsed.inboundVideo).toBeNull();
  });

  test("later entries of the same type win", () => {
    // Documents the current behaviour so a change to it is a deliberate decision.
    const first = { type: "transport", packetsSent: 1 };
    const second = { type: "transport", packetsSent: 2 };

    expect(parseRtcStats(report(first, second)).transport).toBe(second);
  });
});
