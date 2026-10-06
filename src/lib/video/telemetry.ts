import { metrics } from "@/lib/telemetry/metrics";
import type { VideoPlan, VideoPrepareMode } from "./plan";

/** The output's short side, folded onto the ladder: `360`, `480`, `720`, `1080`, `1080+`. */
export function heightBucket(width: number, height: number): string {
  const short = Math.min(width, height);
  if (short <= 360) return "360";
  if (short <= 480) return "480";
  if (short <= 720) return "720";
  if (short <= 1080) return "1080";
  return "1080+";
}

/** `stored`: the server already had the bytes; `none`: refused before a ticket was issued. */
export type VideoUploadTransport = "single" | "multipart" | "stored" | "none";

export function recordPrepared(
  mode: VideoPrepareMode,
  { wallMs, durationMs, bytes, width, height }: { wallMs: number; durationMs: number; bytes: number; width: number; height: number },
): void {
  metrics.count("video.prepare", { mode, result: "ok" });
  metrics.distribution("video.prepare.duration", wallMs, "millisecond", { mode, height: heightBucket(width, height) });
  if (wallMs > 0) metrics.distribution("video.prepare.speed", durationMs / wallMs, "none", { mode });
  metrics.distribution("video.bytes", bytes, "byte", { mode });
}

export function recordPrepareFailed(mode: VideoPrepareMode, error: string): void {
  metrics.count("video.prepare", { mode, result: error === "aborted" ? "aborted" : "failed", error });
}

/**
 * A video that goes out as a plain file because the plan said `original`: counted under
 * `video.prepare` so the fallback rate and its reasons sit next to the prepared ones.
 */
export function recordVideoSentAsFile(plan: VideoPlan): void {
  metrics.count("video.prepare", { mode: "original", result: "ok", reason: plan.reason ?? "unknown" });
  metrics.distribution("video.bytes", plan.sourceBytes, "byte", { mode: "original" });
}

export function recordUpload(transport: VideoUploadTransport, wallMs: number, error?: string): void {
  const result = error === undefined ? "ok" : error === "aborted" ? "aborted" : "failed";
  metrics.count("video.upload", { transport, result, error });
  metrics.distribution("video.upload.duration", wallMs, "millisecond", { transport, result });
}
