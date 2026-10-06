import {
  ALL_FORMATS,
  BlobSource,
  Input,
  MATROSKA,
  MP4,
  QTFF,
  UnsupportedInputFormatError,
  WEBM,
  type AudioCodec,
  type InputFormat,
  type InputTrack,
  type Rotation,
  type VideoCodec,
} from "mediabunny";
import { VideoProbeError } from "./errors";
import { isFastStart, isFragmentedMoov, moovInServerReach, readMvhdDurationMs, readTopLevelBoxes } from "./mp4Boxes";

export type VideoContainer = "mp4" | "mov" | "webm" | "mkv" | "other";

/** What a source file is, as far as preparing it for upload is concerned. */
export interface VideoProbe {
  /** Bytes. */
  size: number;
  container: VideoContainer;
  /** Display size: pixel aspect and rotation applied. */
  width: number;
  height: number;
  rotation: Rotation;
  durationMs: number;
  fps: number | null;
  videoCodec: VideoCodec | null;
  /** RFC 6381 (`avc1.64001f`, `vp09.00.10.08`…). */
  videoCodecString: string | null;
  audioCodec: AudioCodec | null;
  hasAudio: boolean;
  canDecodeVideo: boolean;
  canDecodeAudio: boolean;
  /** Video track bits per second (measured from the packets, else the whole file's average). */
  bitrate: number;
  /** Audio track bits per second, 0 without audio or when unknown. */
  audioBitrate: number;
  /**
   * MP4/MOV with `ftyp` first and `moov` before `mdat`, where the server's header read finds it
   * (header in the first 64 KiB, end within 32 MiB); always false for other containers.
   */
  fastStart: boolean;
  /** Width / height of one coded pixel; 1 for square pixels. A copy keeps the coded size in `tkhd`. */
  pixelAspectRatio: number;
  /** The duration `moov/mvhd` states (what the server reads), null when not an MP4/MOV or unset. */
  headerDurationMs: number | null;
  videoTrackCount: number;
  audioTrackCount: number;
}

/** Packets looked at for the bitrate of a container whose index is not up front (Matroska, TS…). */
const STATS_PREFIX_PACKETS = 600;

function containerOf(format: InputFormat): VideoContainer {
  if (format === MP4) return "mp4";
  if (format === QTFF) return "mov";
  if (format === WEBM) return "webm";
  if (format === MATROSKA) return "mkv";
  return "other";
}

/** Fast start as the server judges it, and the `mvhd` duration it will compare with the declaration. */
async function readHeader(file: Blob): Promise<{ fastStart: boolean; headerDurationMs: number | null }> {
  const boxes = await readTopLevelBoxes(file, { until: (b) => b.type === "mdat" || b.type === "moof" });
  const moov = boxes.find((b) => b.type === "moov");
  const fragmented = !!moov && (await isFragmentedMoov(file, moov));
  return {
    fastStart: isFastStart(boxes) && moovInServerReach(moov) && !fragmented,
    headerDurationMs: moov ? await readMvhdDurationMs(file, moov) : null,
  };
}

async function averageBitrate(track: InputTrack, isobmff: boolean): Promise<{ bitrate: number; rate: number }> {
  try {
    const stats = await track.computePacketStats(isobmff ? undefined : STATS_PREFIX_PACKETS);
    return { bitrate: Math.round(stats.averageBitrate) || 0, rate: stats.averagePacketRate || 0 };
  } catch {
    return { bitrate: 0, rate: 0 };
  }
}

/**
 * Reads what the preparation needs to know about a source video. Nothing is decoded; MP4/MOV are
 * read from their header, other containers from a prefix of their packets.
 *
 * Throws {@link VideoProbeError}: `unsupported-format` (not a container mediabunny reads),
 * `no-video-track`, or `unreadable`.
 */
export async function probeVideo(file: Blob): Promise<VideoProbe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    let format: InputFormat;
    try {
      format = await input.getFormat();
    } catch (e) {
      if (e instanceof UnsupportedInputFormatError) throw new VideoProbeError("unsupported-format", undefined, { cause: e });
      throw e;
    }

    const container = containerOf(format);
    const isobmff = container === "mp4" || container === "mov";

    const [videoTracks, audioTracks] = await Promise.all([input.getVideoTracks(), input.getAudioTracks()]);
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new VideoProbeError("no-video-track");
    const audio = (await video.getPrimaryPairableAudioTrack()) ?? (await input.getPrimaryAudioTrack());

    const [width, height, rotation, pixelAspect, videoCodec, videoCodecString, canDecodeVideo, durationSec, videoStats] = await Promise.all([
      video.getDisplayWidth(),
      video.getDisplayHeight(),
      video.getRotation(),
      video.getPixelAspectRatio().catch(() => ({ num: 1, den: 1 })),
      video.getCodec(),
      video.getCodecParameterString(),
      video.canDecode().catch(() => false),
      input.computeDuration(audio ? [video, audio] : [video]),
      averageBitrate(video, isobmff),
    ]);

    const [audioCodec, canDecodeAudio, audioStats] = audio
      ? await Promise.all([audio.getCodec(), audio.canDecode().catch(() => false), averageBitrate(audio, isobmff)])
      : [null, false, { bitrate: 0, rate: 0 }];

    const durationMs = Math.max(0, Math.round(durationSec * 1000));
    const fallbackBitrate = durationSec > 0 ? Math.round((file.size * 8) / durationSec) - audioStats.bitrate : 0;
    const header = isobmff ? await readHeader(file) : { fastStart: false, headerDurationMs: null };

    return {
      size: file.size,
      container,
      width,
      height,
      rotation,
      durationMs,
      fps: videoStats.rate > 0 ? Math.round(videoStats.rate * 100) / 100 : null,
      videoCodec,
      videoCodecString,
      audioCodec,
      hasAudio: !!audio,
      canDecodeVideo,
      canDecodeAudio,
      bitrate: videoStats.bitrate || Math.max(0, fallbackBitrate),
      audioBitrate: audioStats.bitrate,
      fastStart: header.fastStart,
      pixelAspectRatio: pixelAspect.den > 0 ? pixelAspect.num / pixelAspect.den : 1,
      headerDurationMs: header.headerDurationMs,
      videoTrackCount: videoTracks.length,
      audioTrackCount: audioTracks.length,
    };
  } catch (e) {
    if (e instanceof VideoProbeError) throw e;
    throw new VideoProbeError("unreadable", e instanceof Error ? e.message : String(e), { cause: e });
  } finally {
    input.dispose();
  }
}
