/**
 * The composer's video branch, with the video library mocked: a picked video is probed and given a
 * poster, prepared at once in the background, prepared again (the old run cancelled, its output
 * dropped) whenever how it is sent changes, cancelled when it is removed, and sent as a video — or
 * as a plain file when the user asks, when the plan says it cannot be a video, or when af.chat.video
 * is off.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  attach: vi.fn(),
  prepare: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  upload: vi.fn(),
  find: vi.fn(),
  remember: vi.fn(),
  forget: vi.fn(),
  count: vi.fn(),
  sha: vi.fn(),
  limits: vi.fn(),
}));

const v = vi.hoisted(() => ({
  probeVideo: vi.fn(),
  extractPoster: vi.fn(),
  planVideo: vi.fn(),
  prepareWithinLimit: vi.fn(),
  videoCodecAvailability: vi.fn(),
  uploadVideo: vi.fn(),
  videoEntityOf: vi.fn(),
  videoEntityFromOptimistic: vi.fn(),
  buildStoryboard: vi.fn(),
  recordVideoSentAsFile: vi.fn(),
  quality: { value: "auto" as unknown },
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelInteraction: {
      AttachExistingFile: h.attach,
      PrepareUploadAttachment: h.prepare,
      BeginUploadAttachment: h.begin,
      CompleteUploadAttachment: h.complete,
      GetUploadLimits: h.limits,
    },
    userChatInteractions: {},
  }),
}));
vi.mock("@/lib/uploadFile", () => ({ uploadFile: h.upload }));
vi.mock("@/lib/attachments/uploadPool", () => ({ findUpload: h.find, rememberUpload: h.remember, forgetUpload: h.forget }));
vi.mock("@/lib/attachments/hash", () => ({ sha256Hex: h.sha }));
vi.mock("@/store/system/fileStorage", () => ({ cdnFetchUrl: (id: string) => `https://api.test/files/${id}` }));
vi.mock("@/lib/telemetry/metrics", () => ({
  metrics: { count: h.count, distribution: vi.fn(), startTimer: () => ({ end: vi.fn() }) },
  errorKind: () => "error",
}));
vi.mock("@/lib/video", () => ({
  probeVideo: v.probeVideo,
  extractPoster: v.extractPoster,
  planVideo: v.planVideo,
  prepareWithinLimit: v.prepareWithinLimit,
  videoCodecAvailability: v.videoCodecAvailability,
  uploadVideo: v.uploadVideo,
  videoEntityOf: v.videoEntityOf,
  videoEntityFromOptimistic: v.videoEntityFromOptimistic,
  buildStoryboard: v.buildStoryboard,
  recordVideoSentAsFile: v.recordVideoSentAsFile,
  get videoUploadQuality() {
    return v.quality;
  },
}));

import { toRaw } from "vue";
import { useAttachmentUpload } from "@/composables/useAttachmentUpload";
import { clearUploadLimits } from "@/lib/attachments/uploadLimits";
import { MessageEntityAttachment, SuccessUploadFile, VideoUploadError, type AttachmentInfo } from "@argon/glue";

const MB = 1024n * 1024n;
const target = { kind: "channel", spaceId: "s1", channelId: "c1" } as const;
const UPLOADED = "0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5d";

const PROBE = {
  size: 30_000_000,
  container: "mp4",
  width: 1920,
  height: 1080,
  rotation: 0,
  durationMs: 30_000,
  fps: 30,
  videoCodec: "hevc",
  videoCodecString: "hvc1.1.6.L120.90",
  audioCodec: "aac",
  hasAudio: true,
  canDecodeVideo: true,
  canDecodeAudio: true,
  bitrate: 8_000_000,
  audioBitrate: 128_000,
  fastStart: true,
  videoTrackCount: 1,
  audioTrackCount: 1,
  pixelAspectRatio: 1,
  headerDurationMs: 30_000,
};

const POSTER = { blob: new Blob(["poster"], { type: "image/webp" }), width: 720, height: 404, thumbHash: "HASH" };

interface PrepareCall {
  file: Blob;
  plan: { mode: string; prefs: Record<string, unknown> };
  signal: AbortSignal;
  resolve: (prepared: unknown) => void;
  reject: (e: unknown) => void;
}

let prepareCalls: PrepareCall[] = [];

function plan(prefs: Record<string, unknown>, mode = "transcode", sourceMs = 30_000) {
  const trim = prefs.trim as { startMs: number; endMs: number } | null | undefined;
  return {
    mode,
    reason: mode === "original" ? "undecodable" : null,
    width: prefs.quality === 480 ? 854 : 1280,
    height: prefs.quality === 480 ? 480 : 720,
    durationMs: trim ? trim.endMs - trim.startMs : sourceMs,
    video: mode === "transcode" ? { codec: "avc", width: 1280, height: 720, bitrate: 2_600_000, keyFrameIntervalSec: 2, frameRate: null } : null,
    audio: prefs.mute ? "none" : "copy",
    audioBitrate: prefs.mute ? 0 : 128_000,
    trim: prefs.trim ?? null,
    crop: prefs.crop ?? null,
    rotate: prefs.rotate ?? 0,
    flip: !!prefs.flip,
    sourceBytes: PROBE.size,
    estimatedBytes: 10_000_000,
    downscaledToFit: false,
    prefs,
  };
}

function prepared(size = 1_000) {
  return { blob: new Blob([new Uint8Array(size)], { type: "video/mp4" }), width: 1280, height: 720, durationMs: 30_000, hasAudio: true, codecString: "avc1.64001f", mode: "transcode" };
}

const videoFile = (name = "clip.mp4", type = "video/mp4") => new File([new Uint8Array(64)], name, { type });

let flagOn = true;
let targetKnown = true;
let made: ReturnType<typeof useAttachmentUpload>[] = [];
const make = () => {
  const attachments = useAttachmentUpload({ videoSending: () => flagOn, uploadTarget: () => (targetKnown ? target : null) });
  made.push(attachments);
  return attachments;
};

// Transcodes queue across composers: a test that leaves one running would hold up the next.
afterEach(() => {
  for (const attachments of made) attachments.clear();
  made = [];
  for (const call of prepareCalls) call.reject(new Error("test over"));
});

beforeEach(() => {
  vi.clearAllMocks();
  clearUploadLimits();
  prepareCalls = [];
  flagOn = true;
  targetKnown = true;
  v.quality.value = "auto";
  // This channel takes videos up to 200 MB and one hour.
  h.limits.mockResolvedValue({ attachmentMaxBytes: 25n * MB, videoMaxBytes: 200n * MB, videoMaxDurationMs: 3_600_000n });
  h.sha.mockResolvedValue("c".repeat(64));
  h.find.mockResolvedValue(null);
  h.prepare.mockRejectedValue(new Error("unknown method"));
  h.begin.mockResolvedValue(new SuccessUploadFile("blob-1", "https://upload", [], 60));
  h.upload.mockResolvedValue({ blobId: "blob-1" });
  h.complete.mockResolvedValue({ fileId: UPLOADED, fileName: "clip.mp4", fileSize: 64n, contentType: "video/mp4", downloadUrl: null } as unknown as AttachmentInfo);

  v.probeVideo.mockResolvedValue({ ...PROBE });
  v.extractPoster.mockResolvedValue(POSTER);
  v.videoCodecAvailability.mockResolvedValue({ avc: true, aac: true, aacPolyfill: false });
  v.planVideo.mockImplementation((probe: { durationMs: number }, prefs: Record<string, unknown>) => plan(prefs, "transcode", probe.durationMs));
  // prepareWithinLimit: plans (as the mocked planVideo does) and prepares. A test resolves a call with
  // the prepared video, or with a whole { plan, prepared } to say what the library ended up with.
  v.prepareWithinLimit.mockImplementation(
    (file: Blob, probe: { durationMs: number }, prefs: Record<string, unknown>, _encoders: unknown, options: { signal: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const p = plan(prefs, "transcode", probe.durationMs);
        const done = (value: unknown) => resolve(value && typeof value === "object" && "plan" in value ? value : { plan: p, prepared: value });
        prepareCalls.push({ file, plan: p, signal: options.signal, resolve: done, reject });
        options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError", code: "aborted" })));
      }),
  );
  v.buildStoryboard.mockResolvedValue(null);
  v.videoEntityOf.mockImplementation((info: { fileId: string }) => ({ type: 25, fileId: info.fileId, kind: "video" }));
  v.videoEntityFromOptimistic.mockImplementation((p: { fileName: string }) => ({ type: 25, fileId: "00000000-0000-0000-0000-000000000000", fileName: p.fileName, fileSize: 0n }));
  v.uploadVideo.mockResolvedValue({ fileId: "video-file" });
});

describe("a picked video", () => {
  test("is probed and given a poster a second in, and its size and placeholder come from them", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);

    const entry = attachments.pendingFiles.value[0];
    expect(v.probeVideo).toHaveBeenCalledTimes(1);
    expect(v.extractPoster).toHaveBeenCalledWith(expect.any(File), 1_000);
    expect(entry.video?.probe.durationMs).toBe(30_000);
    expect(entry.thumbHash).toBe("HASH");
    expect(entry.previewUrl).toMatch(/^blob:/);
    expect(entry.video?.prefs).toEqual({ quality: "auto", mute: false, sendAsFile: false });
    // Its bytes are hashed only if it goes as a file.
    expect(h.sha).not.toHaveBeenCalled();
  });

  test("a short one takes its poster at a tenth of its length", async () => {
    v.probeVideo.mockResolvedValue({ ...PROBE, durationMs: 4_000 });
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    expect(v.extractPoster).toHaveBeenCalledWith(expect.any(File), 400);
  });

  test("the default quality comes from the setting", async () => {
    v.quality.value = 720;
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    expect(attachments.pendingFiles.value[0].video?.prefs.quality).toBe(720);
  });

  test("a file the probe cannot read goes the generic way, as a file", async () => {
    v.probeVideo.mockRejectedValue(Object.assign(new Error("unsupported-format"), { name: "VideoProbeError", code: "unsupported-format" }));
    const attachments = make();
    await attachments.addFiles([videoFile("clip.mkv", "")]);

    expect(attachments.pendingFiles.value[0].video).toBeUndefined();
    expect(h.sha).toHaveBeenCalled();
  });

  test("a video by its extension when the browser gave it no type", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile("holiday.MOV", "")]);
    expect(v.probeVideo).toHaveBeenCalled();
    expect(attachments.pendingFiles.value[0].video).toBeDefined();
  });
});

describe("eager preparation", () => {
  test("starts as soon as the video is added, with the plan of its preferences", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));

    expect(v.planVideo).toHaveBeenCalledWith(expect.objectContaining({ width: 1920 }), expect.objectContaining({ quality: "auto", mute: false, maxBytes: 200 * 1024 * 1024 }), { avc: true, aac: true });
    expect(h.limits).toHaveBeenCalledWith("s1", "c1");
    const entry = attachments.pendingFiles.value[0];
    expect(entry.video?.preparing).toMatchObject({ phase: "prepare", progress: 0 });

    prepareCalls[0].resolve(prepared());
    await vi.waitFor(() => expect(entry.video?.prepared).toBeTruthy());
    expect(entry.video?.preparing).toBeNull();
  });

  test("a changed preference cancels the run, drops its output and prepares again", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    prepareCalls[0].resolve(prepared());
    const entry = attachments.pendingFiles.value[0];
    await vi.waitFor(() => expect(entry.video?.prepared).toBeTruthy());

    attachments.setVideoPrefs(0, { quality: 480 });
    expect(entry.video?.prepared).toBeNull();
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(2));
    expect(prepareCalls[1].plan.prefs).toMatchObject({ quality: 480 });

    // Changed again while it runs: the running one is cancelled.
    attachments.setVideoPrefs(0, { mute: true });
    expect(prepareCalls[1].signal.aborted).toBe(true);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(3));
    expect(prepareCalls[2].plan.prefs).toMatchObject({ quality: 480, mute: true });
  });

  test("removing the video cancels its preparation", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));

    attachments.removeFile(0);
    expect(prepareCalls[0].signal.aborted).toBe(true);
    expect(attachments.pendingFiles.value).toHaveLength(0);
  });

  test("the user's stop releases it, and sending runs it again", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));

    attachments.cancelVideoPreparation(0);
    const entry = attachments.pendingFiles.value[0];
    expect(prepareCalls[0].signal.aborted).toBe(true);
    expect(entry.video?.paused).toBe(true);
    expect(entry.video?.preparing).toBeNull();

    const sending = attachments.uploadAll(target);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(2));
    prepareCalls[1].resolve(prepared());
    const entities = await sending;
    expect(v.uploadVideo).toHaveBeenCalledTimes(1);
    expect(entities).toEqual([{ type: 25, fileId: "video-file", kind: "video" }]);
  });

  test("a closed dialog stops it, and opening it again starts it over", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));

    attachments.pausePreparations();
    expect(prepareCalls[0].signal.aborted).toBe(true);
    attachments.resumePreparations();
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(2));
  });

  test("prepared within the target's limit: the source, its probe, the preferences with the limit, the encoders", async () => {
    v.videoCodecAvailability.mockResolvedValue({ avc: true, aac: true, aacPolyfill: false, memoryBudgetBytes: 512 * 1024 * 1024 });
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));

    const [file, probe, prefs, encoders] = v.prepareWithinLimit.mock.calls[0];
    expect(file).toBe(toRaw(attachments.pendingFiles.value[0].video?.source));
    expect(probe).toMatchObject({ width: 1920, durationMs: 30_000 });
    expect(prefs).toMatchObject({ quality: "auto", mute: false, maxBytes: 200 * 1024 * 1024 });
    expect(encoders).toEqual({ avc: true, aac: true, memoryBudgetBytes: 512 * 1024 * 1024 });
  });

  test("an output that overshot and was made a rung lower keeps the lower plan, and says so", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    const lower = plan({ quality: 480 });
    prepareCalls[0].resolve({ plan: lower, prepared: prepared() });

    const entry = attachments.pendingFiles.value[0];
    await vi.waitFor(() => expect(entry.video?.prepared).toBeTruthy());
    expect(entry.video?.steppedDown).toBe(true);
    expect([entry.video?.plan?.width, entry.video?.plan?.height]).toEqual([854, 480]);
    expect([entry.width, entry.height]).toEqual([854, 480]);
  });

  test("when even the lowest rung is too large, it goes as a file", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    prepareCalls[0].resolve({ plan: { ...plan({}, "original"), reason: "too-large" }, prepared: null });

    const entry = attachments.pendingFiles.value[0];
    await vi.waitFor(() => expect(entry.video?.fileReason).toBe("too-large"));
    expect(entry.video?.prefs.sendAsFile).toBe(true);
    expect(entry.video?.prepared).toBeNull();
  });

  test("a failed preparation sends the video as a file and says why", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    prepareCalls[0].reject(Object.assign(new Error("conversion-failed"), { name: "VideoPrepareError", code: "conversion-failed" }));

    const entry = attachments.pendingFiles.value[0];
    await vi.waitFor(() => expect(entry.video?.fileReason).toBe("failed"));
    expect(entry.video?.prefs.sendAsFile).toBe(true);
    expect(entry.video?.error).toBe("conversion-failed");
  });
});

describe("sending", () => {
  test("a video goes up as a video with its poster, and the message carries the video entity", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile("trip.mov", "video/quicktime")]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    const output = prepared(2_048);
    prepareCalls[0].resolve(output);

    const reported: [string, number | null][] = [];
    const entities = await attachments.uploadAll(target, (_entity, phase, fraction) => reported.push([phase, fraction]));

    const [uploadTarget, input] = v.uploadVideo.mock.calls[0];
    expect(uploadTarget).toEqual(target);
    expect(input).toMatchObject({ fileName: "trip.mov", poster: POSTER, storyboard: null, width: 1280, height: 720 });
    expect(input.blob).toBe(output.blob);
    expect(v.buildStoryboard).toHaveBeenCalledWith(output.blob, 30_000);
    expect(entities).toEqual([{ type: 25, fileId: "video-file", kind: "video" }]);
    expect(h.begin).not.toHaveBeenCalled();
    expect(reported.some(([phase]) => phase === "upload")).toBe(true);
  });

  test("the optimistic bubble is a video entity with what the plan measured", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(attachments.pendingFiles.value[0].video?.plan).toBeTruthy());

    const [entity] = attachments.buildOptimisticEntities();
    expect(v.videoEntityFromOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "clip.mp4", width: 1280, height: 720, durationMs: 30_000 }),
      POSTER,
      { posterUrl: attachments.pendingFiles.value[0].previewUrl },
    );
    expect((entity as unknown as { fileSize: bigint }).fileSize).toBe(10_000_000n);
  });

  test("“Send as file” stops the preparation and sends the bytes as an attachment", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));

    attachments.setVideoPrefs(0, { sendAsFile: true });
    expect(prepareCalls[0].signal.aborted).toBe(true);
    const entities = await attachments.uploadAll(target);

    expect(prepareCalls).toHaveLength(1);
    expect(v.uploadVideo).not.toHaveBeenCalled();
    expect(h.begin).toHaveBeenCalled();
    expect(entities[0]).toBeInstanceOf(MessageEntityAttachment);
    expect(v.recordVideoSentAsFile).toHaveBeenCalledWith(expect.objectContaining({ reason: "user-original" }));
  });

  test("a plan that cannot make it playable sends it as a file, with nothing prepared", async () => {
    v.planVideo.mockImplementation((_probe: unknown, prefs: Record<string, unknown>) => plan(prefs, "original"));
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    const entry = attachments.pendingFiles.value[0];
    await vi.waitFor(() => expect(entry.video?.fileReason).toBe("undecodable"));

    expect(entry.video?.prefs.sendAsFile).toBe(true);
    expect(v.prepareWithinLimit).not.toHaveBeenCalled();
    // The user cannot turn a forced file back into a video.
    attachments.setVideoPrefs(0, { sendAsFile: false });
    expect(entry.video?.prefs.sendAsFile).toBe(true);

    const entities = await attachments.uploadAll(target);
    expect(entities[0]).toBeInstanceOf(MessageEntityAttachment);
    expect(v.recordVideoSentAsFile).toHaveBeenCalledWith(expect.objectContaining({ mode: "original", reason: "undecodable" }));
  });

  test("a failed upload keeps its failure for the message", async () => {
    const failure = Object.assign(new Error("TOO_LARGE"), { name: "VideoUploadFailure", code: 2 });
    v.uploadVideo.mockRejectedValue(failure);
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    prepareCalls[0].resolve(prepared());

    const uploader = attachments.detach();
    const entities = await uploader.uploadAll(target);
    expect(entities).toEqual([]);
    expect(uploader.hasErrors()).toBe(true);
    expect(uploader.videoFailure()).toBe(failure);
  });
});

describe("the target's upload limits", () => {
  test("the plan gets the target's video size, and asking once serves every video of the target", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile("a.mp4"), videoFile("b.mp4")]);
    await vi.waitFor(() => expect(v.planVideo).toHaveBeenCalledTimes(2));

    for (const [, prefs] of v.planVideo.mock.calls) expect(prefs.maxBytes).toBe(200 * 1024 * 1024);
    expect(h.limits).toHaveBeenCalledTimes(1);
    expect(attachments.pendingFiles.value[0].video?.limits).toEqual({ maxBytes: 200 * 1024 * 1024, maxDurationMs: 3_600_000 });
  });

  test("a video longer than the target takes goes as a file, refused before any preparation", async () => {
    v.probeVideo.mockResolvedValue({ ...PROBE, durationMs: 2 * 3_600_000 });
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    const entry = attachments.pendingFiles.value[0];
    await vi.waitFor(() => expect(entry.video?.fileReason).toBe("too-long"));

    expect(entry.video?.prefs.sendAsFile).toBe(true);
    expect(v.prepareWithinLimit).not.toHaveBeenCalled();
    const entities = await attachments.uploadAll(target);
    expect(entities[0]).toBeInstanceOf(MessageEntityAttachment);
    expect(v.recordVideoSentAsFile).toHaveBeenCalledWith(expect.objectContaining({ reason: "too-long" }));
  });

  test("trimmed under the limit in the editor, it is a video again", async () => {
    v.probeVideo.mockResolvedValue({ ...PROBE, durationMs: 2 * 3_600_000 });
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    const entry = attachments.pendingFiles.value[0];
    await vi.waitFor(() => expect(entry.video?.fileReason).toBe("too-long"));

    attachments.applyVideoEdit(0, { trim: { startMs: 0, endMs: 60_000 }, crop: null, rotate: 0, flip: false, mute: false, quality: null, coverMs: null });
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    expect(entry.video?.fileReason).toBeNull();
    expect(entry.video?.prefs.sendAsFile).toBe(false);
  });

  test("a server without GetUploadLimits does not stop sending: 100 MB and 4 h apply", async () => {
    h.limits.mockRejectedValue(new Error("Unknown method IChannelInteraction.GetUploadLimits"));
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));

    expect(v.planVideo.mock.calls[0][1].maxBytes).toBe(100 * 1024 * 1024);
    expect(attachments.pendingFiles.value[0].video?.limits).toEqual({ maxBytes: 100 * 1024 * 1024, maxDurationMs: 4 * 3_600_000 });
    prepareCalls[0].resolve(prepared());
    expect(await attachments.uploadAll(target)).toEqual([{ type: 25, fileId: "video-file", kind: "video" }]);
  });

  test("without a known target the defaults apply and nothing is asked", async () => {
    targetKnown = false;
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(v.planVideo).toHaveBeenCalled());
    expect(v.planVideo.mock.calls[0][1].maxBytes).toBe(100 * 1024 * 1024);
    expect(h.limits).not.toHaveBeenCalled();
  });

  test("a TOO_LARGE refusal drops the target's limits, so the next video asks again", async () => {
    v.uploadVideo.mockRejectedValue(Object.assign(new Error("TOO_LARGE"), { name: "VideoUploadFailure", code: VideoUploadError.TOO_LARGE }));
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    prepareCalls[0].resolve(prepared());
    await attachments.uploadAll(target);
    expect(h.limits).toHaveBeenCalledTimes(1);

    await attachments.addFiles([videoFile("next.mp4")]);
    await vi.waitFor(() => expect(h.limits).toHaveBeenCalledTimes(2));
  });
});

describe("with af.chat.video off", () => {
  test("a video/mp4 file takes the plain attachment path: no probe, no preparation, no video entity", async () => {
    flagOn = false;
    // happy-dom loads no media: the element errors, and the generic path goes on without a preview.
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = create(tag);
      if (tag === "video") {
        Object.defineProperty(el, "src", {
          set() {
            queueMicrotask(() => (el as HTMLVideoElement).onerror?.(new Event("error")));
          },
        });
      }
      return el;
    }) as typeof document.createElement);

    const attachments = make();
    await attachments.addFiles([videoFile()]);
    const entry = attachments.pendingFiles.value[0];
    expect(v.probeVideo).not.toHaveBeenCalled();
    expect(entry.video).toBeUndefined();
    expect(h.sha).toHaveBeenCalled();

    const [optimistic] = attachments.buildOptimisticEntities();
    expect(optimistic).toBeInstanceOf(MessageEntityAttachment);
    const entities = await attachments.uploadAll(target);
    expect(v.prepareWithinLimit).not.toHaveBeenCalled();
    expect(v.uploadVideo).not.toHaveBeenCalled();
    expect(entities[0]).toBeInstanceOf(MessageEntityAttachment);
  });
});

describe("an edit from the media editor", () => {
  test("trim / crop / turn go into the preferences and the source is prepared again with them", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));

    attachments.applyVideoEdit(0, {
      trim: { startMs: 1_000, endMs: 9_000 },
      crop: { left: 0, top: 0, width: 1080, height: 1080 },
      rotate: 90,
      flip: true,
      mute: true,
      quality: 480,
      coverMs: 2_000,
    });
    expect(prepareCalls[0].signal.aborted).toBe(true);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(2));

    const entry = attachments.pendingFiles.value[0];
    expect(prepareCalls[1].file).toBe(toRaw(entry.video?.source));
    expect(prepareCalls[1].plan.prefs).toMatchObject({
      quality: 480,
      mute: true,
      trim: { startMs: 1_000, endMs: 9_000 },
      crop: { left: 0, top: 0, width: 1080, height: 1080 },
      rotate: 90,
      flip: true,
    });
    expect(entry.video?.prefs.coverMs).toBe(2_000);
    expect(entry.sha256).toBeNull();
    expect(entry.link).toBeNull();
  });

  test("a render replaces the bytes with what the editor rendered, then prepares that", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile("trip.mov", "video/quicktime")]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));

    let finish!: (v: { blob: Blob; hasSound: boolean }) => void;
    const rendered = new Blob([new Uint8Array(10)], { type: "video/mp4" });
    attachments.renderVideoEdit(0, {
      getResult: () => new Promise((resolve) => (finish = resolve)),
      cancel: vi.fn(),
      creationProgress: { value: 0 },
    });
    const entry = attachments.pendingFiles.value[0];
    expect(entry.video?.preparing?.phase).toBe("render");

    finish({ blob: rendered, hasSound: true });
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(2));
    expect(entry.file.name).toBe("trip.mp4");
    expect(entry.file.size).toBe(10);
    expect(entry.video?.source.name).toBe("trip.mov");
    expect(prepareCalls[1].file).toBe(toRaw(entry.file));
  });

  test("cancelling a render drops the edit and the video is prepared as it was", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    const entry = attachments.pendingFiles.value[0];
    const before = entry.previewUrl;

    let fail!: (e: unknown) => void;
    const cancel = vi.fn(() => fail(new DOMException("cancelled", "AbortError")));
    attachments.renderVideoEdit(0, { getResult: () => new Promise((_, reject) => (fail = reject)), cancel });
    attachments.cancelVideoPreparation(0);

    expect(cancel).toHaveBeenCalled();
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(2));
    expect(entry.previewUrl).toBe(before);
    expect(toRaw(entry.file)).toBe(toRaw(entry.video?.source));
    expect(entry.video?.error).toBeNull();
  });
});
