export const MAX_EDITABLE_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

export interface PlatformCapabilities {
  gpu: boolean;
  videoEncode: boolean;
  audioEncode: boolean;
}

/** Codec configs to test for video encoding support. */
const CODEC_PROBES: VideoEncoderConfig[] = [
  { codec: 'avc1.4d4028', width: 1920, height: 1080, bitrate: 20e6, framerate: 60 },
  { codec: 'avc1.42001f', width: 1280, height: 720, bitrate: 14e6, framerate: 60 },
];

let cachedCaps: PlatformCapabilities | undefined;

/**
 * Probe browser capabilities for media editing features.
 * Results are cached after first call.
 */
export async function checkCapabilities(): Promise<PlatformCapabilities> {
  if (cachedCaps) return cachedCaps;

  const gpu = !!navigator.gpu;

  let videoEncode = true;
  for (const cfg of CODEC_PROBES) {
    const { supported } = await VideoEncoder.isConfigSupported(cfg);
    if (!supported) { videoEncode = false; break; }
  }

  const { supported: audioEncode } = await AudioEncoder.isConfigSupported({
    codec: 'opus',
    sampleRate: 48000,
    numberOfChannels: 2,
    bitrate: 128_000,
  });

  cachedCaps = { gpu, videoEncode, audioEncode: !!audioEncode };
  return cachedCaps;
}
