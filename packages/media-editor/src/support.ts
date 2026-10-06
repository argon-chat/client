export const MAX_EDITABLE_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

export interface PlatformCapabilities {
  /** A WebGPU adapter exists: the editor renders through it. */
  gpu: boolean;
  /** WebCodecs can encode H.264 at 720p, the least an edited video is rendered at. */
  videoEncode: boolean;
  /** WebCodecs can encode AAC natively (the export falls back to a WASM encoder otherwise). */
  audioEncode: boolean;
}

/** Why a video cannot be opened in the editor here. */
export type VideoEditBlock = 'no-gpu' | 'no-encoder' | 'too-large';

const H264_PROBES: VideoEncoderConfig[] = [
  { codec: 'avc1.42001f', width: 1280, height: 720, bitrate: 2_600_000, framerate: 30 },
  { codec: 'avc1.4d4028', width: 1280, height: 720, bitrate: 2_600_000, framerate: 30 },
];

let cachedCaps: Promise<PlatformCapabilities> | undefined;

async function hasGpuAdapter(): Promise<boolean> {
  const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
  if (!gpu) return false;
  try {
    // navigator.gpu exists in headless and blocklisted browsers that hand out no adapter.
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

async function canEncodeH264(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  for (const config of H264_PROBES) {
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return true;
    } catch {
      /* the next profile */
    }
  }
  return false;
}

async function canEncodeAac(): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const { supported } = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128_000 });
    return !!supported;
  } catch {
    return false;
  }
}

/** What this browser can do for the editor, probed once. */
export function checkCapabilities(): Promise<PlatformCapabilities> {
  cachedCaps ??= Promise.all([hasGpuAdapter(), canEncodeH264(), canEncodeAac()]).then(([gpu, videoEncode, audioEncode]) => ({
    gpu,
    videoEncode,
    audioEncode,
  }));
  return cachedCaps;
}

/** Why a video of `size` bytes cannot be edited with these capabilities, or null when it can. */
export function videoEditBlock(size: number, caps: PlatformCapabilities): VideoEditBlock | null {
  if (!caps.gpu) return 'no-gpu';
  if (!caps.videoEncode) return 'no-encoder';
  if (size > MAX_EDITABLE_VIDEO_SIZE) return 'too-large';
  return null;
}

/** Tests. */
export function resetCapabilities(): void {
  cachedCaps = undefined;
}
