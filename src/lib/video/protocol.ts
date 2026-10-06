import type { VideoCodec } from "mediabunny";
import type { VideoPlan } from "./plan";
import type { VideoPrepareErrorCode } from "./errors";
import type { Mp4Description } from "./convert";

/** Page → transcode worker. One worker runs one job. */
export type TranscodeToWorker = { type: "start"; file: Blob; plan: VideoPlan; videoCodec?: VideoCodec } | { type: "cancel" };

/** Transcode worker → page. `buffer` is transferred. */
export type TranscodeFromWorker =
  | { type: "started" }
  | { type: "progress"; fraction: number }
  | { type: "done"; buffer: ArrayBuffer; description: Mp4Description }
  | { type: "error"; code: VideoPrepareErrorCode; message: string };
