/**
 * The composer's video branch, with the video library mocked. Picking a video does only the cheap
 * part: probe, poster and plan (the dialog's size estimate and "goes as a file" reasons). Nothing is
 * compressed until Send; then each video is prepared (one at a time, across composers) and uploaded,
 * and its bubble gets one combined, ever-growing progress. A video goes as a plain file when the user
 * asks or when the plan (or the target's limits) say it cannot be a video.
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
import { useAttachmentUpload, type PendingAttachment } from "@/composables/useAttachmentUpload";
import { clearUploadLimits } from "@/lib/attachments/uploadLimits";
import { MessageEntityAttachment, SuccessUploadFile, VideoUploadError, type AttachmentInfo } from "@argon/glue";
import type { EditingMediaState } from "@argon/media-editor";

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
  plan: ReturnType<typeof plan>;
  progress: (fraction: number) => void;
  resolve: (value: unknown) => void;
  reject: (e: unknown) => void;
}

let prepareCalls: PrepareCall[] = [];
let planMode = "transcode";

function plan(prefs: Record<string, unknown>, mode = planMode, sourceMs = 30_000) {
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
    maxBytes: prefs.maxBytes,
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

let targetKnown = true;
let made: ReturnType<typeof useAttachmentUpload>[] = [];
const make = () => {
  const attachments = useAttachmentUpload({ uploadTarget: () => (targetKnown ? target : null) });
  made.push(attachments);
  return attachments;
};

/** A video added and planned. */
async function withVideo(name = "clip.mp4", type = "video/mp4") {
  const attachments = make();
  await attachments.addFiles([videoFile(name, type)]);
  await vi.waitFor(() => expect(attachments.pendingFiles.value.at(-1)?.video?.plan).toBeTruthy());
  return attachments;
}

/** Records what the bubble is told: [phase, combined fraction]. */
function bubble() {
  const seen: [string, number | null][] = [];
  return { seen, report: (_entity: unknown, phase: string, fraction: number | null) => seen.push([phase, fraction]) };
}

// The preparation queue spans composers: a test that leaves one waiting would hold up the next.
afterEach(() => {
  for (const attachments of made) attachments.clear();
  made = [];
  for (const call of prepareCalls) call.reject(new Error("test over"));
});

beforeEach(() => {
  vi.clearAllMocks();
  clearUploadLimits();
  prepareCalls = [];
  targetKnown = true;
  planMode = "transcode";
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
  v.videoCodecAvailability.mockResolvedValue({ avc: true, aac: true, aacPolyfill: false, memoryBudgetBytes: 512 * 1024 * 1024 });
  v.planVideo.mockImplementation((probe: { durationMs: number }, prefs: Record<string, unknown>) => plan(prefs, planMode, probe.durationMs));
  // prepareWithinLimit: a test drives a call's progress and resolves it with the prepared video (or a
  // whole { plan, prepared } to say what the library ended up with).
  v.prepareWithinLimit.mockImplementation(
    (file: Blob, probe: { durationMs: number }, prefs: Record<string, unknown>, _encoders: unknown, options: { onProgress?: (f: number) => void }) =>
      new Promise((resolve, reject) => {
        const p = plan(prefs, planMode, probe.durationMs);
        const done = (value: unknown) => resolve(value && typeof value === "object" && "plan" in value ? value : { plan: p, prepared: value });
        prepareCalls.push({ file, plan: p, progress: (f) => options.onProgress?.(f), resolve: done, reject });
      }),
  );
  v.buildStoryboard.mockResolvedValue(null);
  v.videoEntityOf.mockImplementation((info: { fileId: string }) => ({ type: 25, fileId: info.fileId, kind: "video" }));
  v.videoEntityFromOptimistic.mockImplementation((p: { fileName: string }) => ({ type: 25, fileId: "00000000-0000-0000-0000-000000000000", fileName: p.fileName, fileSize: 0n }));
  v.uploadVideo.mockResolvedValue({ fileId: "video-file" });
});

describe("a picked video", () => {
  test("is probed, given a poster a second in and planned — and nothing is compressed", async () => {
    const attachments = await withVideo();

    const entry = attachments.pendingFiles.value[0];
    expect(v.probeVideo).toHaveBeenCalledTimes(1);
    expect(v.extractPoster).toHaveBeenCalledWith(expect.any(File), 1_000);
    expect(entry.thumbHash).toBe("HASH");
    expect(entry.previewUrl).toMatch(/^blob:/);
    expect(entry.video?.prefs).toEqual({ quality: "auto", mute: false, sendAsFile: false });
    expect(v.planVideo).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1920 }),
      expect.objectContaining({ quality: "auto", mute: false, maxBytes: 200 * 1024 * 1024 }),
      { avc: true, aac: true, memoryBudgetBytes: 512 * 1024 * 1024 },
    );
    expect([entry.width, entry.height]).toEqual([1280, 720]);

    expect(v.prepareWithinLimit).not.toHaveBeenCalled();
    expect(v.buildStoryboard).not.toHaveBeenCalled();
    // Its bytes are hashed only if it goes as a file.
    expect(h.sha).not.toHaveBeenCalled();
  });

  test("a changed preference plans it again, and still compresses nothing", async () => {
    const attachments = await withVideo();
    attachments.setVideoPrefs(0, { quality: 480 });
    await vi.waitFor(() => expect(attachments.pendingFiles.value[0].video?.plan?.height).toBe(480));
    attachments.setVideoPrefs(0, { mute: true });
    await vi.waitFor(() => expect(v.planVideo).toHaveBeenCalledTimes(3));
    expect(v.planVideo.mock.calls[2][1]).toMatchObject({ quality: 480, mute: true });
    expect(v.prepareWithinLimit).not.toHaveBeenCalled();
  });

  test("a short one takes its poster at a tenth of its length; the default quality is the setting's", async () => {
    v.probeVideo.mockResolvedValue({ ...PROBE, durationMs: 4_000 });
    v.quality.value = 720;
    const attachments = await withVideo();
    expect(v.extractPoster).toHaveBeenCalledWith(expect.any(File), 400);
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
    const attachments = await withVideo("holiday.MOV", "");
    expect(attachments.pendingFiles.value[0].video).toBeDefined();
  });

  test("a plan that cannot make it playable sends it as a file, locked, with nothing prepared", async () => {
    planMode = "original";
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    const entry = attachments.pendingFiles.value[0];
    await vi.waitFor(() => expect(entry.video?.fileReason).toBe("undecodable"));

    expect(entry.video?.prefs.sendAsFile).toBe(true);
    attachments.setVideoPrefs(0, { sendAsFile: false });
    expect(entry.video?.prefs.sendAsFile).toBe(true);

    const entities = await attachments.uploadAll(target);
    expect(v.prepareWithinLimit).not.toHaveBeenCalled();
    expect(entities[0]).toBeInstanceOf(MessageEntityAttachment);
    expect(v.recordVideoSentAsFile).toHaveBeenCalledWith(expect.objectContaining({ mode: "original", reason: "undecodable" }));
  });
});

describe("sending", () => {
  test("prepares, then uploads with the poster and the storyboard; the bubble gets one combined, growing value", async () => {
    const attachments = await withVideo("trip.mov", "video/quicktime");
    const output = prepared(2_048);
    const storyboard = { blob: new Blob(["sprite"]), storyboard: { frameWidth: 160, frameHeight: 90, columns: 10, frameCount: 12, intervalMs: 1_000 } };
    v.buildStoryboard.mockResolvedValue(storyboard);
    v.uploadVideo.mockImplementation(async (_t: unknown, _input: unknown, opts: { onProgress: (stage: string, f: number) => void }) => {
      opts.onProgress("poster", 1);
      opts.onProgress("storyboard", 1);
      opts.onProgress("video", 0.5);
      opts.onProgress("video", 1);
      return { fileId: "video-file" };
    });
    const { seen, report } = bubble();

    const sending = attachments.uploadAll(target, report);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    // Prepared from the file as picked, within the target's limit.
    const [file, , prefs, encoders] = v.prepareWithinLimit.mock.calls[0];
    expect(file).toBe(toRaw(attachments.pendingFiles.value[0].video?.source));
    expect(prefs).toMatchObject({ maxBytes: 200 * 1024 * 1024 });
    expect(encoders).toEqual({ avc: true, aac: true, memoryBudgetBytes: 512 * 1024 * 1024 });
    prepareCalls[0].progress(0.5);
    prepareCalls[0].resolve(output);
    const entities = await sending;

    const [, input] = v.uploadVideo.mock.calls[0];
    expect(input).toMatchObject({ fileName: "trip.mov", poster: POSTER, storyboard, width: 1280, height: 720 });
    expect(input.blob).toBe(output.blob);
    expect(v.buildStoryboard).toHaveBeenCalledWith(output.blob, 30_000);
    expect(entities).toEqual([{ type: 25, fileId: "video-file", kind: "video" }]);

    // A transcode: compress 0.6 (preparation 0.85 of it, storyboard 0.15), upload 0.4.
    const values = seen.map(([, f]) => f as number);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(seen).toContainEqual(["prepare", expect.closeTo(0.255, 5)]);
    expect(seen).toContainEqual(["prepare", expect.closeTo(0.6, 5)]);
    expect(seen).toContainEqual(["upload", expect.closeTo(0.82, 5)]);
    expect(seen.at(-1)).toEqual(["upload", 1]);
  });

  test("a copy is all upload: compressing leaves the ring at 0", async () => {
    planMode = "copy";
    const attachments = await withVideo();
    v.uploadVideo.mockImplementation(async (_t: unknown, _i: unknown, opts: { onProgress: (stage: string, f: number) => void }) => {
      opts.onProgress("video", 0.5);
      return { fileId: "video-file" };
    });
    const { seen, report } = bubble();
    const sending = attachments.uploadAll(target, report);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    prepareCalls[0].progress(0.9);
    prepareCalls[0].resolve(prepared());
    await sending;

    expect(seen.filter(([phase]) => phase === "prepare").every(([, f]) => f === 0)).toBe(true);
    expect(seen).toContainEqual(["upload", expect.closeTo(0.45, 5)]);
    expect(seen.at(-1)).toEqual(["upload", 1]);
  });

  test("videos are prepared one at a time, across composers; an upload does not hold up the next preparation", async () => {
    const first = await withVideo("a.mp4");
    const second = await withVideo("b.mp4");
    let finishFirstUpload!: () => void;
    v.uploadVideo.mockImplementationOnce(() => new Promise((resolve) => (finishFirstUpload = () => resolve({ fileId: "a" }))));

    const sendingFirst = first.uploadAll(target);
    const sendingSecond = second.uploadAll(target);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(prepareCalls).toHaveLength(1);

    prepareCalls[0].resolve(prepared());
    // The first is uploading now; the second is prepared meanwhile.
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(2));
    expect(v.uploadVideo).toHaveBeenCalledTimes(1);
    prepareCalls[1].resolve(prepared());
    await sendingSecond;
    finishFirstUpload();
    await sendingFirst;
    expect(v.uploadVideo).toHaveBeenCalledTimes(2);
  });

  test("a failed preparation fails the send with its error, and nothing is uploaded", async () => {
    const attachments = await withVideo();
    const uploader = attachments.detach();
    const sending = uploader.uploadAll(target);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    const failure = Object.assign(new Error("conversion-failed"), { name: "VideoPrepareError", code: "conversion-failed" });
    prepareCalls[0].reject(failure);

    expect(await sending).toEqual([]);
    expect(uploader.hasErrors()).toBe(true);
    expect(uploader.videoFailure()).toBe(failure);
    expect(v.uploadVideo).not.toHaveBeenCalled();
    expect(h.begin).not.toHaveBeenCalled();
  });

  test("a failed upload keeps its failure for the message", async () => {
    const failure = Object.assign(new Error("TOO_LARGE"), { name: "VideoUploadFailure", code: 2 });
    v.uploadVideo.mockRejectedValue(failure);
    const attachments = await withVideo();
    const uploader = attachments.detach();
    const sending = uploader.uploadAll(target);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    prepareCalls[0].resolve(prepared());

    expect(await sending).toEqual([]);
    expect(uploader.videoFailure()).toBe(failure);
  });

  test("an output that overshot and was made a rung lower is uploaded as it came", async () => {
    const attachments = await withVideo();
    const sending = attachments.uploadAll(target);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    const lower = { ...prepared(), width: 854, height: 480 };
    prepareCalls[0].resolve({ plan: plan({ quality: 480 }), prepared: lower });
    await sending;
    expect(v.uploadVideo.mock.calls[0][1]).toMatchObject({ width: 854, height: 480 });
  });

  test("when even the lowest rung is too large, it goes as a file", async () => {
    const attachments = await withVideo();
    const sending = attachments.uploadAll(target);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    prepareCalls[0].resolve({ plan: { ...plan({}, "original"), reason: "too-large" }, prepared: null });
    const entities = await sending;
    expect(v.uploadVideo).not.toHaveBeenCalled();
    expect(entities[0]).toBeInstanceOf(MessageEntityAttachment);
  });

  test("the optimistic bubble is a video entity with what the plan expects", async () => {
    const attachments = await withVideo();
    const [entity] = attachments.buildOptimisticEntities();
    expect(v.videoEntityFromOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "clip.mp4", width: 1280, height: 720, durationMs: 30_000 }),
      POSTER,
      { posterUrl: attachments.pendingFiles.value[0].previewUrl },
    );
    expect((entity as unknown as { fileSize: bigint }).fileSize).toBe(10_000_000n);
  });

  test("“Send as file” sends the bytes as an attachment, with nothing prepared", async () => {
    const attachments = await withVideo();
    attachments.setVideoPrefs(0, { sendAsFile: true });
    const entities = await attachments.uploadAll(target);

    expect(v.prepareWithinLimit).not.toHaveBeenCalled();
    expect(v.uploadVideo).not.toHaveBeenCalled();
    expect(h.begin).toHaveBeenCalled();
    expect(entities[0]).toBeInstanceOf(MessageEntityAttachment);
    expect(v.recordVideoSentAsFile).toHaveBeenCalledWith(expect.objectContaining({ reason: "user-original" }));
  });
});

describe("the target's upload limits", () => {
  test("asked once for every video of the target", async () => {
    const attachments = make();
    await attachments.addFiles([videoFile("a.mp4"), videoFile("b.mp4")]);
    await vi.waitFor(() => expect(v.planVideo).toHaveBeenCalledTimes(2));
    for (const [, prefs] of v.planVideo.mock.calls) expect(prefs.maxBytes).toBe(200 * 1024 * 1024);
    expect(h.limits).toHaveBeenCalledTimes(1);
    expect(h.limits).toHaveBeenCalledWith("s1", "c1");
    expect(attachments.pendingFiles.value[0].video?.limits).toEqual({ maxBytes: 200 * 1024 * 1024, maxDurationMs: 3_600_000 });
  });

  test("a video longer than the target takes goes as a file, and nothing is prepared at send", async () => {
    v.probeVideo.mockResolvedValue({ ...PROBE, durationMs: 2 * 3_600_000 });
    const attachments = make();
    await attachments.addFiles([videoFile()]);
    const entry = attachments.pendingFiles.value[0];
    await vi.waitFor(() => expect(entry.video?.fileReason).toBe("too-long"));

    expect(entry.video?.prefs.sendAsFile).toBe(true);
    const entities = await attachments.uploadAll(target);
    expect(v.prepareWithinLimit).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(entry.video?.fileReason).toBeNull());
    expect(entry.video?.prefs.sendAsFile).toBe(false);
  });

  test("a server without GetUploadLimits does not stop sending: 100 MB and 4 h apply", async () => {
    h.limits.mockRejectedValue(new Error("Unknown method IChannelInteraction.GetUploadLimits"));
    const attachments = await withVideo();
    expect(v.planVideo.mock.calls[0][1].maxBytes).toBe(100 * 1024 * 1024);
    const sending = attachments.uploadAll(target);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    prepareCalls[0].resolve(prepared());
    expect(await sending).toEqual([{ type: 25, fileId: "video-file", kind: "video" }]);
  });

  test("without a known target the defaults apply and nothing is asked", async () => {
    targetKnown = false;
    await withVideo();
    expect(v.planVideo.mock.calls[0][1].maxBytes).toBe(100 * 1024 * 1024);
    expect(h.limits).not.toHaveBeenCalled();
  });

  test("a TOO_LARGE refusal drops the target's limits, so the next video asks again", async () => {
    v.uploadVideo.mockRejectedValue(Object.assign(new Error("TOO_LARGE"), { name: "VideoUploadFailure", code: VideoUploadError.TOO_LARGE }));
    const attachments = await withVideo();
    const sending = attachments.uploadAll(target);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    prepareCalls[0].resolve(prepared());
    await sending;
    expect(h.limits).toHaveBeenCalledTimes(1);

    await attachments.addFiles([videoFile("next.mp4")]);
    await vi.waitFor(() => expect(h.limits).toHaveBeenCalledTimes(2));
  });
});

describe("an edit from the media editor", () => {
  test("trim / crop / turn become preferences of the source, prepared with them only at send", async () => {
    const attachments = await withVideo();
    attachments.applyVideoEdit(0, {
      trim: { startMs: 1_000, endMs: 9_000 },
      crop: { left: 0, top: 0, width: 1080, height: 1080 },
      rotate: 90,
      flip: true,
      mute: true,
      quality: 480,
      coverMs: 2_000,
    });
    const entry = attachments.pendingFiles.value[0];
    await vi.waitFor(() => expect(v.planVideo).toHaveBeenCalledTimes(2));
    expect(v.prepareWithinLimit).not.toHaveBeenCalled();
    expect(entry.sha256).toBeNull();
    expect(entry.link).toBeNull();
    expect(entry.video?.prefs.coverMs).toBe(2_000);

    const sending = attachments.uploadAll(target);
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
    expect(prepareCalls[0].file).toBe(toRaw(entry.video?.source));
    expect(prepareCalls[0].plan.prefs).toMatchObject({
      quality: 480,
      mute: true,
      trim: { startMs: 1_000, endMs: 9_000 },
      crop: { left: 0, top: 0, width: 1080, height: 1080 },
      rotate: 90,
      flip: true,
    });
    prepareCalls[0].resolve(prepared());
    await sending;
  });

  test("a painted edit is rendered only at send; then what it rendered is prepared and uploaded", async () => {
    const attachments = await withVideo("trip.mov", "video/quicktime");
    let finish!: (value: { blob: Blob; hasSound: boolean }) => void;
    const getResult = vi.fn(() => new Promise<{ blob: Blob; hasSound: boolean }>((resolve) => (finish = resolve)));
    const creationProgress = { value: 0 };
    attachments.renderVideoEdit(0, { getResult, cancel: vi.fn(), creationProgress });
    await new Promise((r) => setTimeout(r, 10));
    expect(getResult).not.toHaveBeenCalled();
    expect(v.prepareWithinLimit).not.toHaveBeenCalled();

    const entry: PendingAttachment = attachments.pendingFiles.value[0];
    const { seen, report } = bubble();
    const sending = attachments.uploadAll(target, report);
    await vi.waitFor(() => expect(getResult).toHaveBeenCalledTimes(1));
    finish({ blob: new Blob([new Uint8Array(10)], { type: "video/mp4" }), hasSound: true });
    await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));

    expect(entry.file.name).toBe("trip.mp4");
    expect(entry.file.size).toBe(10);
    expect(entry.video?.source.name).toBe("trip.mov");
    expect(prepareCalls[0].file).toBe(toRaw(entry.file));
    prepareCalls[0].resolve(prepared());
    await sending;
    expect(v.uploadVideo).toHaveBeenCalledTimes(1);
    expect(seen[0][0]).toBe("render");
    // Rendered: compress 0.6, of which the render is 0.75.
    expect(seen).toContainEqual(["render", expect.closeTo(0.45, 5)]);
  });

  test("a render that fails at send fails the message", async () => {
    const attachments = await withVideo();
    attachments.renderVideoEdit(0, { getResult: () => Promise.reject(new Error("GPU lost")), cancel: vi.fn() });
    const uploader = attachments.detach();
    expect(await uploader.uploadAll(target)).toEqual([]);
    expect((uploader.videoFailure() as Error).name).toBe("VideoRenderError");
    expect(v.prepareWithinLimit).not.toHaveBeenCalled();
  });

  test("sound and quality changed in the window after an edit are written into the editor's saved state", async () => {
    const attachments = await withVideo();
    const editorState = { videoCropStart: 0.1, videoCropLength: 0.5, videoMuted: false, videoQuality: 1080 } as EditingMediaState;
    attachments.applyVideoEdit(
      0,
      { trim: { startMs: 3_000, endMs: 18_000 }, crop: null, rotate: 0, flip: false, mute: false, quality: null, coverMs: null },
      { editorState },
    );
    const entry = attachments.pendingFiles.value[0];

    attachments.setVideoPrefs(0, { quality: 480 });
    attachments.setVideoPrefs(0, { mute: true });
    expect(entry.video?.editorState).toMatchObject({ videoCropStart: 0.1, videoCropLength: 0.5, videoMuted: true, videoQuality: 480 });

    // Auto is the top rung the source reaches, as the editor's slider shows it.
    attachments.setVideoPrefs(0, { quality: "auto" });
    expect(entry.video?.editorState?.videoQuality).toBe(1080);
    // The state handed in stays as the editor left it.
    expect(editorState).toMatchObject({ videoMuted: false, videoQuality: 1080 });
  });

  test("a painted edit keeps the editor's sound and picked quality as preferences", async () => {
    const attachments = await withVideo();
    attachments.renderVideoEdit(0, { getResult: vi.fn(), cancel: vi.fn() }, { mute: true, quality: 480 });
    expect(attachments.pendingFiles.value[0].video?.prefs).toMatchObject({ mute: true, quality: 480, trim: null, crop: null });

    // Left where it opened: the composer's quality stays.
    attachments.renderVideoEdit(0, { getResult: vi.fn(), cancel: vi.fn() }, { mute: false, quality: null });
    expect(attachments.pendingFiles.value[0].video?.prefs).toMatchObject({ mute: false, quality: 480 });
  });

  test("a painted edit not sent is cancelled when the video is removed, or replaced by another edit", async () => {
    const attachments = await withVideo();
    const first = { getResult: vi.fn(), cancel: vi.fn() };
    attachments.renderVideoEdit(0, first);
    attachments.applyVideoEdit(0, { trim: null, crop: null, rotate: 0, flip: false, mute: true, quality: null, coverMs: null });
    expect(first.cancel).toHaveBeenCalled();

    const second = { getResult: vi.fn(), cancel: vi.fn() };
    attachments.renderVideoEdit(0, second);
    attachments.removeFile(0);
    expect(second.cancel).toHaveBeenCalled();
    expect(first.getResult).not.toHaveBeenCalled();
    expect(second.getResult).not.toHaveBeenCalled();
  });
});
