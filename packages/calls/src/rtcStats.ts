// @argon/calls - RTC stats parser

export interface ParsedRtcStats {
  inboundAudio: any | null;
  inboundVideo: any | null;
  outboundAudio: any | null;
  outboundVideo: any | null;
  candidatePair: any | null;
  codec: any | null;
  transport: any | null;
  playout: any | null;
}

/**
 * Parse raw WebRTC stats into structured format
 */
export function parseRtcStats(raw: any[]): ParsedRtcStats {
  const stats: ParsedRtcStats = {
    inboundAudio: null,
    inboundVideo: null,
    outboundAudio: null,
    outboundVideo: null,
    candidatePair: null,
    codec: null,
    transport: null,
    playout: null,
  };

  for (const [id, s] of raw) {
    switch (s.type) {
      case "inbound-rtp":
        if (s.kind === "audio") stats.inboundAudio = s;
        if (s.kind === "video") stats.inboundVideo = s;
        break;

      case "remote-outbound-rtp":
        if (s.kind === "audio") stats.outboundAudio = s;
        if (s.kind === "video") stats.outboundVideo = s;
        break;

      case "candidate-pair":
        if (s.state === "succeeded") stats.candidatePair = s;
        break;

      case "transport":
        stats.transport = s;
        break;

      case "codec":
        stats.codec = s;
        break;

      case "media-playout":
        stats.playout = s;
        break;
    }
  }

  return stats;
}
