import { videoMemoryBudget, type VideoEncoderAvailability } from "./plan";

export interface VideoCodecAvailability extends VideoEncoderAvailability {
  /** AAC comes from the WASM polyfill (@mediabunny/aac-encoder), not the browser. */
  aacPolyfill: boolean;
}

let aacReady: Promise<{ aac: boolean; polyfill: boolean }> | null = null;

/**
 * Makes AAC encodable in this realm (page or worker), registering the WASM encoder when WebCodecs
 * has none (Firefox, Chromium without proprietary codecs). Once per realm.
 */
export function ensureAacEncoder(): Promise<{ aac: boolean; polyfill: boolean }> {
  aacReady ??= (async () => {
    const { canEncodeAudio } = await import("mediabunny");
    if (await canEncodeAudio("aac").catch(() => false)) return { aac: true, polyfill: false };
    try {
      const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
      registerAacEncoder();
      return { aac: await canEncodeAudio("aac").catch(() => false), polyfill: true };
    } catch {
      return { aac: false, polyfill: false };
    }
  })();
  return aacReady;
}

let availability: Promise<VideoCodecAvailability> | null = null;

/** Whether this browser can encode H.264 and AAC (with the polyfill), and its memory budget; probed once. */
export function videoCodecAvailability(): Promise<VideoCodecAvailability> {
  availability ??= (async () => {
    const { canEncode } = await import("mediabunny");
    const [avc, aac] = await Promise.all([canEncode("avc").catch(() => false), ensureAacEncoder()]);
    return { avc, aac: aac.aac, aacPolyfill: aac.polyfill, memoryBudgetBytes: videoMemoryBudget() };
  })();
  return availability;
}
