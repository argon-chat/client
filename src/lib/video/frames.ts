import { ALL_FORMATS, BlobSource, Input, type InputVideoTrack } from "mediabunny";
import { VideoPrepareError, VideoProbeError } from "./errors";

/** A decoder that gives no frame for this long is taken as one that cannot decode the video. */
export const FRAME_TIMEOUT_MS = 15_000;

/** `promise`, or `undecodable` when it has not settled within {@link FRAME_TIMEOUT_MS}. */
export function withinFrameTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new VideoPrepareError("undecodable", `No frame was decoded within ${FRAME_TIMEOUT_MS} ms`)), FRAME_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Opens `src` and hands its primary video track to `run`, once it is known that this browser decodes
 * it. Rejects with VideoPrepareError `undecodable` when it does not (or a decode fails), `aborted`
 * when `signal` fires (the input is disposed at once, which stops a decode in flight), and
 * VideoProbeError `no-video-track`. `checkAbort` is for `run` to call between frames.
 */
export async function withDecodableTrack<T>(
  src: Blob,
  signal: AbortSignal | undefined,
  run: (track: InputVideoTrack, checkAbort: () => void) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw new VideoPrepareError("aborted");
  const input = new Input({ source: new BlobSource(src), formats: ALL_FORMATS });
  const onAbort = () => input.dispose();
  signal?.addEventListener("abort", onAbort, { once: true });
  const checkAbort = () => {
    if (signal?.aborted) throw new VideoPrepareError("aborted");
  };

  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new VideoProbeError("no-video-track");
    if (!(await track.canDecode().catch(() => false))) {
      throw new VideoPrepareError("undecodable", `This browser cannot decode ${(await track.getCodecParameterString()) ?? "this video"}`);
    }
    return await run(track, checkAbort);
  } catch (e) {
    if (signal?.aborted) throw new VideoPrepareError("aborted", undefined, { cause: e });
    if (e instanceof VideoPrepareError || e instanceof VideoProbeError) throw e;
    throw new VideoPrepareError("undecodable", e instanceof Error ? e.message : String(e), { cause: e });
  } finally {
    signal?.removeEventListener("abort", onAbort);
    input.dispose();
  }
}
