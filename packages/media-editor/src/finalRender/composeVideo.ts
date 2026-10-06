import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  EncodedPacket,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
} from 'mediabunny';
import { selectEncodingProfile } from './videoEncoding';

/** One rendered frame: drawn as it is, at the output's size. */
export interface ComposeFrame {
  image: CanvasImageSource;
  /** Seconds from the output's start; strictly increasing. */
  timestamp: number;
  /** Seconds; the gap to the next frame is used when absent. */
  duration?: number;
}

export interface ComposeAudio {
  /** The file the audio is taken from. */
  source: Blob;
  /** Seconds of the source. */
  start: number;
  end: number;
}

export interface ComposeVideoOptions {
  frames: AsyncIterable<ComposeFrame>;
  width: number;
  height: number;
  /** Seconds of output, for the progress. */
  duration: number;
  bitrate: number;
  /** Frames per second the encoder is told to expect. */
  frameRate: number;
  /** WebCodecs codec string; by default the H.264 profile for the size. */
  codecString?: string;
  /** Seconds between key frames. */
  keyFrameInterval?: number;
  /** Carried over from the source as AAC; null or absent for a silent output. */
  audio?: ComposeAudio | null;
  /** Output seconds whose frame becomes the cover (the first frame until that one is reached). */
  coverAt?: number | null;
  /** Longest side of the cover. */
  coverMaxSide?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Test hook: VP9 for a browser without an H.264 encoder. Never set in the app. */
  videoCodec?: 'avc' | 'vp9';
}

export interface ComposedVideo {
  /** video/mp4, fast start. */
  blob: Blob;
  hasSound: boolean;
  thumb?: {
    blob: Blob;
    size: { width: number; height: number };
  };
}

export const AUDIO_BITRATE = 128_000;
const KEY_FRAME_INTERVAL = 2;
const COVER_MAX_SIDE = 720;
const COVER_QUALITY = 0.85;
/** How far ahead of the video the audio conversion is run, in output seconds. */
const AUDIO_STEP = 1;
/** Frames waiting in the encoder before the producer is held back. */
const MAX_ENCODE_QUEUE = 8;

let aacReady: Promise<boolean> | null = null;

/** AAC in this realm: the browser's encoder, else the WASM one (Firefox, Chromium without proprietary codecs). */
export function ensureAacEncoder(): Promise<boolean> {
  aacReady ??= (async () => {
    if (await canEncodeAudio('aac').catch(() => false)) return true;
    try {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
      return await canEncodeAudio('aac').catch(() => false);
    } catch {
      return false;
    }
  })();
  return aacReady;
}

function abortError(): DOMException {
  return new DOMException('The export was cancelled.', 'AbortError');
}

function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function encodeImage(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  const encode = (type: string): Promise<Blob | null> =>
    'convertToBlob' in canvas
      ? canvas.convertToBlob({ type, quality: COVER_QUALITY }).catch(() => null)
      : new Promise((resolve) => canvas.toBlob(resolve, type, COVER_QUALITY));
  const webp = await encode('image/webp');
  if (webp?.type === 'image/webp') return webp;
  return encode('image/jpeg');
}

/** Adds the source's audio over `audio`'s range to `output`, or null when it has none that can go into AAC. */
async function audioConversion(output: Output, audio: ComposeAudio): Promise<{ conversion: Conversion; input: Input } | null> {
  await ensureAacEncoder();
  const input = new Input({ source: new BlobSource(audio.source), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) {
      input.dispose();
      return null;
    }
    const channels = await track.getNumberOfChannels();
    const conversion = await Conversion.init({
      input,
      output,
      composable: true,
      tracks: 'primary',
      video: { discard: true },
      audio: {
        codec: 'aac',
        quality: new Quality({ bitrate: AUDIO_BITRATE }),
        numberOfChannels: channels > 2 ? 2 : undefined,
      },
      trim: { start: audio.start, end: audio.end },
      showWarnings: false,
    });
    if (!conversion.utilizedTracks.some((t) => t.isAudioTrack())) {
      await conversion.cancel();
      input.dispose();
      return null;
    }
    return { conversion, input };
  } catch (e) {
    input.dispose();
    throw e;
  }
}

/**
 * Encodes rendered frames into a fast-start MP4 and carries the source's audio over the same range
 * into it as AAC, through a composable Conversion that runs in step with the frames. Knows nothing
 * of how the frames are made, so it runs without a GPU.
 *
 * A cancel through `signal` stops the encoder and the conversion and rejects with an `AbortError`.
 */
export async function composeVideo(options: ComposeVideoOptions): Promise<ComposedVideo> {
  const { width, height, signal } = options;
  const codec = options.videoCodec ?? 'avc';
  const codecString = options.codecString ?? (codec === 'vp9' ? 'vp09.00.10.08' : selectEncodingProfile(width, height, options.frameRate).codec);
  const keyFrameInterval = options.keyFrameInterval ?? KEY_FRAME_INTERVAL;
  const duration = Math.max(1e-3, options.duration);
  const progress = (f: number) => options.onProgress?.(Math.min(1, Math.max(0, f)));
  if (signal?.aborted) throw abortError();

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const videoSource = new EncodedVideoPacketSource(codec);
  output.addVideoTrack(videoSource);

  let encoder: VideoEncoder | null = null;
  let audio: { conversion: Conversion; input: Input } | null = null;
  let started = false;
  const onAbort = () => {
    if (encoder && encoder.state !== 'closed') encoder.close();
    void audio?.conversion.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    audio = options.audio && !signal?.aborted ? await audioConversion(output, options.audio) : null;
    if (signal?.aborted) throw abortError();

    await output.start();
    started = true;

    let addChain: Promise<void> = Promise.resolve();
    let encodeError: unknown = null;
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        addChain = addChain.then(() => videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta));
        addChain.catch(() => {});
      },
      error: (e) => {
        encodeError = e;
      },
    });
    encoder.configure({
      codec: codecString,
      width,
      height,
      bitrate: Math.round(options.bitrate),
      framerate: options.frameRate,
      ...(codec === 'avc' ? { avc: { format: 'avc' as const } } : {}),
    });

    const coverAt = options.coverAt ?? null;
    const coverSize = fitSize(width, height, options.coverMaxSide ?? COVER_MAX_SIDE);
    let cover: HTMLCanvasElement | OffscreenCanvas | null = null;
    let coverTaken = false;
    let lastTimestamp = -Infinity;
    let lastKey = -Infinity;
    let audioUntil = 0;

    for await (const frame of options.frames) {
      if (signal?.aborted) throw abortError();
      if (encodeError) throw encodeError;
      const ts = Math.max(0, frame.timestamp);
      if (ts <= lastTimestamp) continue;
      lastTimestamp = ts;

      // The first frame stands in until the chosen one is reached.
      if (!cover || (!coverTaken && coverAt !== null && ts >= coverAt - 1e-3)) {
        cover ??= makeCanvas(coverSize.width, coverSize.height);
        (cover.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D).drawImage(frame.image, 0, 0, coverSize.width, coverSize.height);
        if (coverAt === null || ts >= coverAt - 1e-3) coverTaken = true;
      }

      const keyFrame = ts - lastKey >= keyFrameInterval - 1e-6;
      if (keyFrame) lastKey = ts;
      const init: VideoFrameInit = { timestamp: Math.round(ts * 1e6) };
      if (frame.duration && frame.duration > 0) init.duration = Math.round(frame.duration * 1e6);
      const videoFrame = new VideoFrame(frame.image, init);
      try {
        encoder.encode(videoFrame, { keyFrame });
      } finally {
        videoFrame.close();
      }

      while (encoder.encodeQueueSize > MAX_ENCODE_QUEUE && !signal?.aborted) await new Promise((r) => setTimeout(r, 0));

      if (audio && ts >= audioUntil) {
        audioUntil = ts + AUDIO_STEP;
        await audio.conversion.execute({ until: audioUntil });
      }
      progress((ts / duration) * 0.98);
    }

    if (signal?.aborted) throw abortError();
    if (lastTimestamp < 0) throw new Error('No frames to encode');
    await encoder.flush();
    await addChain;
    if (encodeError) throw encodeError;
    encoder.close();
    if (audio) await audio.conversion.execute();
    if (signal?.aborted) throw abortError();
    await output.finalize();

    const buffer = output.target.buffer;
    if (!buffer) throw new Error('The export produced no file');
    const thumbBlob = cover ? await encodeImage(cover) : null;
    progress(1);
    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      hasSound: !!audio,
      thumb: thumbBlob ? { blob: thumbBlob, size: coverSize } : undefined,
    };
  } catch (e) {
    if (encoder && encoder.state !== 'closed') encoder.close();
    if (audio && audio.conversion.state !== 'done' && audio.conversion.state !== 'canceled') await audio.conversion.cancel().catch(() => {});
    if (started) await output.cancel().catch(() => {});
    if (signal?.aborted) throw abortError();
    throw e;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    audio?.input.dispose();
  }
}
