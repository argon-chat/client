import { ref, computed, getCurrentScope, onScopeDispose, markRaw, reactive, toRaw, watch } from "vue";
import { logger } from "@argon/core";
import { metrics, errorKind } from "@/lib/telemetry/metrics";
import {
  AttachExistingFileError,
  EntityType,
  MessageEntityAttachment,
  PrepareUploadError,
  SuccessUploadFile,
  VideoUploadError,
  type AttachmentInfo,
  type IAttachExistingFileResult,
  type IMessageEntity,
  type IPrepareUploadResult,
  type IUploadFileResult,
} from "@argon/glue";
import type { EditingMediaState } from "@argon/media-editor";
import { useApi } from "@/store/system/apiStore";
import { uploadFile } from "@/lib/uploadFile";
import { rgbaToThumbHash } from "thumbhash";
import type { Guid } from "@argon-chat/ion.webcore";
import { sha256Hex } from "@/lib/attachments/hash";
import { findUpload, forgetUpload, rememberUpload } from "@/lib/attachments/uploadPool";
import type { AttachmentRef } from "@/lib/attachments/clipboard";
import type { VideoEditPrefs } from "@/lib/attachments/videoEdit";
import { DEFAULT_UPLOAD_LIMITS, invalidateUploadLimits, resolveUploadLimits } from "@/lib/attachments/uploadLimits";
import { VideoSendProgress, type VideoSendStep } from "@/lib/attachments/videoSendProgress";
import { cdnFetchUrl } from "@/store/system/fileStorage";
import { canvasToWebp, context2d, createCanvas } from "@/lib/video/image";
import { thumbHashOf } from "@/lib/video/thumbhash";
import type {
  PreparedVideo,
  VideoCrop,
  VideoOriginalReason,
  VideoEncoderAvailability,
  VideoPlan,
  VideoPoster,
  VideoPrefs,
  VideoProbe,
  VideoQuality,
  VideoRotation,
  VideoStoryboardSprite,
  VideoTrim,
} from "@/lib/video";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const MAX_ATTACHMENTS = 10;
const THUMBHASH_MAX_DIM = 100;

/** Where the picked file's own poster is taken from: one second in, or a tenth of a shorter video. */
const POSTER_AT_MS = 1_000;
const POSTER_MAX_SIDE = 720;
const POSTER_QUALITY = 0.85;

export type AttachmentStatus = "pending" | "uploading" | "done" | "error";

/** Where the files go: a channel of a space, or the direct chat with one person. */
export type UploadTarget =
  | { kind: "channel"; spaceId: Guid; channelId: Guid }
  | { kind: "dm"; peerId: Guid };

/** How a pending attachment came to point at a file the server already has; "server" is the server finding one by the hash. */
export type LinkOrigin = "pool" | "clipboard" | "drag" | "server";

export interface AttachmentLink {
  fileId: Guid;
  /** The name the copy is given; null keeps the original's. */
  fileName: string | null;
  origin: LinkOrigin;
}

/** How a video is to be sent; applied when the message is sent. */
export interface PendingVideoPrefs {
  quality: VideoQuality;
  mute: boolean;
  /** Goes as a plain file: the user's choice, or forced (see {@link PendingVideo.fileReason}). */
  sendAsFile: boolean;
  trim?: VideoTrim | null;
  crop?: VideoCrop | null;
  rotate?: VideoRotation;
  flip?: boolean;
  /** The cover frame, ms of the source; null for the default. */
  coverMs?: number | null;
}

/** Why a video goes as a file although the user did not ask: the plan's reason, or a length over what the target takes. */
export type VideoFileReason = VideoOriginalReason | "too-long";

/** The target's limits a video was planned against. */
export interface VideoLimits {
  maxBytes: number;
  maxDurationMs: number;
}

/** The editor's render of a painted video, run when the message is sent (a MediaEditorFinalResult). */
export interface VideoRender {
  getResult: () => { blob: Blob; hasSound: boolean; thumb?: { blob: Blob } } | Promise<{ blob: Blob; hasSound: boolean; thumb?: { blob: Blob } }>;
  cancel?: () => void;
  creationProgress?: { value: number };
  preview?: Blob;
}

/**
 * A video in the composer. Nothing heavy happens until it is sent: picking it probes it, takes its
 * poster and plans it (for the expected size and whether it can go as a video at all).
 */
export interface PendingVideo {
  /** Of the bytes in `file` (the source, or what the editor rendered). */
  probe: VideoProbe;
  /** For the dialog's estimate and reasons; planned again at send. */
  plan: VideoPlan | null;
  prefs: PendingVideoPrefs;
  poster?: VideoPoster | null;
  /** "invalid-trim": the plan refused the trim. */
  error?: "invalid-trim" | null;
  /** Set while it goes as a file because it cannot go as a video; `prefs.sendAsFile` is then true. */
  fileReason?: VideoFileReason | null;
  /** The user's own "Send as file", which a forced file must not overwrite. */
  requestedFile?: boolean;
  /** What the target allowed when it was last planned. */
  limits?: VideoLimits | null;
  /** The file as picked, and what it probed as: what the editor opens and what edits apply to. */
  source: File;
  sourceProbe: VideoProbe;
  /** The editor's state after the last edit, to reopen it where it was left. */
  editorState?: EditingMediaState | null;
  /** A painted edit, rendered when the message is sent. */
  render?: VideoRender | null;
}

export interface PendingAttachment {
  file: File;
  previewUrl: string | null;
  thumbHash: string | null;
  width: number | null;
  height: number | null;
  progress: number;
  status: AttachmentStatus;
  error?: string;
  result?: AttachmentInfo;
  /** The bytes' hash when they were small enough to take one; the key into the upload pool. */
  sha256?: string | null;
  /** A file already on the server that these bytes are: sent as a copy of it, uploaded only when that is refused. */
  link?: AttachmentLink | null;
  /** Set for a video: it is sent as a video unless it goes as a file. */
  video?: PendingVideo;
  /** What was sent for a video, once it is. */
  entity?: IMessageEntity;
  /** Why sending a video failed (a VideoUploadFailure, a VideoPrepareError…). */
  failure?: unknown;
}

/** What a video's send is doing, for the optimistic bubble; `fraction` is the combined 0..1 of the whole send. */
export type VideoSendPhase = "render" | "prepare" | "upload";
export type VideoSendReporter = (entity: IMessageEntity | undefined, phase: VideoSendPhase, fraction: number | null) => void;

export interface AttachmentUploadOptions {
  /** Where the files will go, for its upload limits; null until known (the defaults apply). */
  uploadTarget?: () => UploadTarget | null;
}

type VideoLib = typeof import("@/lib/video");
let videoLibPromise: Promise<VideoLib> | null = null;
/** Set once the library has loaded; anything holding a `video` loaded it. */
let videoLib: VideoLib | null = null;

function loadVideoLib(): Promise<VideoLib> {
  videoLibPromise ??= import("@/lib/video").then((lib) => (videoLib = lib));
  return videoLibPromise;
}

const VIDEO_EXTENSION = /\.(mp4|m4v|mov|mkv|webm)$/i;

/** A video by its type, or by its name when the browser gave it no type. */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || (!file.type && VIDEO_EXTENSION.test(file.name));
}

/** Whether the editor changed what the frames are (trim, crop, turn, mirror): those need a preparation even for a file. */
export function videoIsEdited(prefs: PendingVideoPrefs): boolean {
  return !!prefs.trim || !!prefs.crop || !!prefs.rotate || !!prefs.flip;
}

/** Whether a pending attachment goes out as a video (rather than as a file). */
export function goesAsVideo(entry: PendingAttachment): boolean {
  return !!entry.video && !entry.video.prefs.sendAsFile;
}

// Videos are compressed one at a time, across composers: each holds an encoder and a whole output in
// memory. Uploads overlap freely.
let prepareQueue: Promise<void> = Promise.resolve();
async function inPrepareQueue<T>(run: () => Promise<T>): Promise<T> {
  const previous = prepareQueue;
  let release!: () => void;
  prepareQueue = new Promise<void>((resolve) => (release = resolve));
  try {
    await previous;
    return await run();
  } finally {
    release();
  }
}

function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
}

/** A poster (WebP ≤ 720 px + ThumbHash) from a still the editor rendered. */
async function posterFromImage(blob: Blob): Promise<VideoPoster | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, POSTER_MAX_SIDE);
      const canvas = createCanvas(width, height);
      context2d(canvas).drawImage(bitmap, 0, 0, width, height);
      return { blob: await canvasToWebp(canvas, POSTER_QUALITY), width, height, thumbHash: thumbHashOf(canvas, width, height) };
    } finally {
      bitmap.close();
    }
  } catch (e) {
    logger.debug("poster from the editor's still skipped", e);
    return null;
  }
}

function mp4Name(name: string): string {
  const stem = name.replace(/\.[^./\\]+$/, "").trim();
  return `${stem || "video"}.mp4`;
}

/** The editor's render failed at send: the message fails with this. */
export class VideoRenderError extends Error {
  override name = "VideoRenderError";
}

/** The plan refused the edits at send (a trim too short): the message fails with this. */
export class VideoPlanError extends Error {
  override name = "VideoPlanError";
}

interface VideoContext {
  lib: VideoLib;
  encoders: VideoEncoderAvailability;
  limits: VideoLimits;
}

/** A video made ready to upload, or the word that it goes as a file after all. */
type Compressed =
  | { prepared: PreparedVideo; storyboard: VideoStoryboardSprite | null; progress: VideoSendProgress }
  | { prepared: null; progress: VideoSendProgress | null };

export function useAttachmentUpload(options: AttachmentUploadOptions = {}) {
  const api = useApi();
  const pendingFiles = ref<PendingAttachment[]>([]);

  /** The target's video limits (asked once per target), or the defaults while it is not known. */
  async function videoLimits(): Promise<VideoLimits> {
    const target = options.uploadTarget?.() ?? null;
    const limits = target ? await resolveUploadLimits(api, target) : DEFAULT_UPLOAD_LIMITS;
    return { maxBytes: limits.videoMaxBytes, maxDurationMs: limits.videoMaxDurationMs };
  }

  async function videoContext(): Promise<VideoContext> {
    const [lib, limits] = await Promise.all([loadVideoLib(), videoLimits()]);
    const available = await lib.videoCodecAvailability();
    return { lib, limits, encoders: { avc: available.avc, aac: available.aac, memoryBudgetBytes: available.memoryBudgetBytes } };
  }

  // Per entry (by its raw object): the latest planning's generation (an older one that finishes
  // later is dropped), and the optimistic entity a send showed for it.
  const generations = new WeakMap<object, number>();
  const optimisticOf = new WeakMap<object, IMessageEntity>();

  const hasFiles = computed(() => pendingFiles.value.length > 0);
  const isUploading = computed(() =>
    pendingFiles.value.some((f) => f.status === "uploading"),
  );

  function validateFile(file: File): string | null {
    if (pendingFiles.value.length >= MAX_ATTACHMENTS) {
      return `Maximum ${MAX_ATTACHMENTS} attachments allowed`;
    }
    return null;
  }

  function isImageType(contentType: string): boolean {
    return contentType.startsWith("image/");
  }

  function isVideoType(contentType: string): boolean {
    return contentType.startsWith("video/");
  }

  async function getVideoDimensions(
    file: File,
  ): Promise<{ width: number; height: number; previewUrl: string }> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.onloadeddata = () => {
        video.currentTime = 0.1;
      };
      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) {
            const previewUrl = URL.createObjectURL(blob);
            resolve({ width: video.videoWidth, height: video.videoHeight, previewUrl });
          } else {
            reject(new Error("Failed to generate video thumbnail"));
          }
        }, "image/jpeg", 0.8);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load video"));
      };
      video.src = url;
    });
  }

  async function getImageDimensions(
    file: File,
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        reject(new Error("Failed to load image"));
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  async function generateThumbHash(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = url;
      });

      // Scale down to ≤100×100 preserving aspect ratio
      const scale = Math.min(
        THUMBHASH_MAX_DIM / img.naturalWidth,
        THUMBHASH_MAX_DIM / img.naturalHeight,
        1,
      );
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);

      const pixels = ctx.getImageData(0, 0, w, h);
      const hash = rgbaToThumbHash(w, h, pixels.data);
      return btoa(String.fromCharCode(...hash));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** The preview, dimensions and placeholder of an entry; what a reference already knows is kept. */
  async function describe(entry: PendingAttachment, need = { dimensions: true, thumbHash: true }) {
    const file = entry.file;
    if (isImageType(file.type)) {
      entry.previewUrl ??= URL.createObjectURL(file);
      try {
        if (need.dimensions) {
          const dims = await getImageDimensions(file);
          entry.width = dims.width;
          entry.height = dims.height;
        }
        if (need.thumbHash) entry.thumbHash = await generateThumbHash(file);
      } catch (e) {
        logger.warn("Failed to process image metadata:", e);
      }
    } else if (isVideoType(file.type)) {
      try {
        const videoInfo = await getVideoDimensions(file);
        if (entry.previewUrl) URL.revokeObjectURL(videoInfo.previewUrl);
        else entry.previewUrl = videoInfo.previewUrl;
        if (need.dimensions) {
          entry.width = videoInfo.width;
          entry.height = videoInfo.height;
        }
      } catch (e) {
        logger.warn("Failed to process video metadata:", e);
      }
    }
  }

  /**
   * A video's probe and poster: it is then sent as a video. False when the file cannot be read as
   * one (it goes the generic way, as a file).
   */
  async function describeVideo(entry: PendingAttachment): Promise<boolean> {
    let lib: VideoLib;
    let probe: VideoProbe;
    try {
      lib = await loadVideoLib();
      probe = await lib.probeVideo(entry.file);
    } catch (e) {
      logger.info("Not readable as a video; attached as a file:", e);
      return false;
    }

    let poster: VideoPoster | null = null;
    if (probe.canDecodeVideo) {
      try {
        poster = await lib.extractPoster(entry.file, Math.min(POSTER_AT_MS, probe.durationMs * 0.1));
      } catch (e) {
        logger.debug("video poster skipped", e);
      }
    }

    if (poster) {
      entry.previewUrl = URL.createObjectURL(poster.blob);
      entry.thumbHash = poster.thumbHash;
    } else {
      // A codec the page's decoder lacks may still play in an element.
      await describe(entry, { dimensions: false, thumbHash: false });
    }
    entry.width = probe.width;
    entry.height = probe.height;
    entry.video = {
      probe: markRaw(probe),
      plan: null,
      prefs: { quality: lib.videoUploadQuality.value, mute: false, sendAsFile: false },
      poster: poster ? markRaw(poster) : null,
      error: null,
      fileReason: null,
      source: entry.file,
      sourceProbe: markRaw(probe),
      editorState: null,
      render: null,
    };
    return true;
  }

  async function hashOf(file: File): Promise<string | null> {
    try {
      return await sha256Hex(file);
    } catch (e) {
      logger.debug("hashing skipped", e);
      return null;
    }
  }

  // ── Video planning (cheap; the dialog's estimate and reasons) ──────────────────────────────────

  function videoPrefsOf(v: PendingVideo, limits: VideoLimits): VideoPrefs {
    const prefs = v.prefs;
    return {
      quality: prefs.quality,
      mute: prefs.mute,
      trim: prefs.trim ? { ...prefs.trim } : null,
      crop: prefs.crop ? { ...prefs.crop } : null,
      rotate: prefs.rotate ?? 0,
      flip: prefs.flip ?? false,
      maxBytes: limits.maxBytes,
    };
  }

  /**
   * Plans the video as it stands and decides whether it can go as a video: an `original` plan (not
   * playable from here) or a length over the target's limit sends it as a file, with the reason.
   * Null when the plan refuses the edits.
   */
  function applyPlan(entry: PendingAttachment, { lib, encoders, limits }: VideoContext): VideoPlan | null {
    const v = entry.video!;
    v.limits = limits;
    let plan: VideoPlan;
    try {
      plan = lib.planVideo(toRaw(v.probe), videoPrefsOf(v, limits), encoders);
    } catch (e) {
      logger.warn("The video's edits cannot be planned:", e);
      v.plan = null;
      v.error = "invalid-trim";
      return null;
    }
    v.plan = markRaw(plan);
    v.error = null;
    entry.width = plan.width;
    entry.height = plan.height;

    if (plan.mode === "original") {
      v.fileReason = plan.reason;
      v.prefs.sendAsFile = true;
    } else if (plan.durationMs > limits.maxDurationMs) {
      v.fileReason = "too-long";
      v.prefs.sendAsFile = true;
    } else if (v.fileReason) {
      // What forced a file before (an Original quality, a length) no longer applies.
      v.fileReason = null;
      v.prefs.sendAsFile = !!v.requestedFile;
    }
    return plan;
  }

  /** Plans a video again after anything about it changed; a later planning wins. */
  async function refreshPlan(entry: PendingAttachment): Promise<void> {
    const v = entry.video;
    if (!v) return;
    const raw = toRaw(entry);
    const generation = (generations.get(raw) ?? 0) + 1;
    generations.set(raw, generation);
    let context: VideoContext;
    try {
      context = await videoContext();
    } catch (e) {
      logger.warn("The video library could not load:", e);
      return;
    }
    if (generations.get(raw) !== generation || entry.video !== v) return;
    applyPlan(entry, context);
  }

  function videoAt(index: number): PendingAttachment | null {
    const entry = pendingFiles.value[index];
    return entry?.video ? entry : null;
  }

  /** Changes how one video is sent (quality, sound, as a file). */
  function setVideoPrefs(index: number, patch: Partial<Pick<PendingVideoPrefs, "quality" | "mute" | "sendAsFile">>) {
    const entry = videoAt(index);
    if (!entry) return;
    const v = entry.video!;
    if (patch.sendAsFile !== undefined) {
      if (v.fileReason) return;
      v.requestedFile = patch.sendAsFile;
    }
    Object.assign(v.prefs, patch);
    void refreshPlan(entry);
  }

  async function setPosterFrom(entry: PendingAttachment, still: Blob | undefined) {
    const v = entry.video;
    if (!v || !still) return;
    const poster = await posterFromImage(still);
    if (!poster || entry.video !== v) return;
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    entry.previewUrl = URL.createObjectURL(poster.blob);
    entry.thumbHash = poster.thumbHash;
    v.poster = markRaw(poster);
  }

  /** Drops a painted edit that has not been rendered: its GPU resources go with it. */
  function dropRender(v: PendingVideo) {
    v.render?.cancel?.();
    v.render = null;
  }

  /**
   * An editor result that only trims, crops, turns, mirrors, mutes or lowers the quality: kept as
   * preferences of the source, applied by the converter when the message is sent (no frame
   * rendered). `still` is the editor's cover frame, the poster from now on.
   */
  function applyVideoEdit(index: number, edit: VideoEditPrefs, extras: { still?: Blob; editorState?: EditingMediaState } = {}) {
    const entry = videoAt(index);
    if (!entry) return;
    const v = entry.video!;
    dropRender(v);
    Object.assign(v.prefs, {
      trim: edit.trim,
      crop: edit.crop,
      rotate: edit.rotate,
      flip: edit.flip,
      mute: edit.mute,
      coverMs: edit.coverMs,
      ...(edit.quality ? { quality: edit.quality } : {}),
    });
    if (extras.editorState) v.editorState = markRaw(extras.editorState);
    // An edited file is new bytes.
    entry.sha256 = null;
    entry.link = null;
    void setPosterFrom(entry, extras.still);
    void refreshPlan(entry);
  }

  /**
   * An editor result that changed the pixels: kept as it is and rendered when the message is sent.
   * The geometry is in the render, so the preferences keep only quality and sound.
   */
  function renderVideoEdit(index: number, render: VideoRender, extras: { editorState?: EditingMediaState } = {}) {
    const entry = videoAt(index);
    if (!entry) {
      render.cancel?.();
      return;
    }
    const v = entry.video!;
    dropRender(v);
    v.render = markRaw(render);
    Object.assign(v.prefs, { trim: null, crop: null, rotate: 0, flip: false, coverMs: null });
    if (extras.editorState) v.editorState = markRaw(extras.editorState);
    entry.sha256 = null;
    entry.link = null;
    void setPosterFrom(entry, render.preview);
    void refreshPlan(entry);
  }

  async function addFiles(files: FileList | File[]): Promise<string[]> {
    const errors: string[] = [];

    for (const file of Array.from(files)) {
      const err = validateFile(file);
      if (err) {
        errors.push(err);
        continue;
      }

      const entry: PendingAttachment = {
        file,
        previewUrl: null,
        thumbHash: null,
        width: null,
        height: null,
        progress: 0,
        status: "pending",
        sha256: null,
        link: null,
      };

      // A video is probed, given a poster and planned; it is compressed only when sent, and its
      // bytes are hashed only if it goes as a file.
      if (isVideoFile(file) && (await describeVideo(entry))) {
        pendingFiles.value.push(entry);
        void refreshPlan(reactive(entry) as PendingAttachment);
        continue;
      }

      await describe(entry);

      // Bytes this account has sent before go out as a copy of that upload, not as bytes again.
      entry.sha256 = await hashOf(file);
      if (entry.sha256) {
        const known = await findUpload(entry.sha256);
        if (known) entry.link = { fileId: known.fileId, fileName: file.name, origin: "pool" };
      }

      pendingFiles.value.push(entry);
    }

    return errors;
  }

  /**
   * Files the server already has, arriving as references — a paste of something copied out of a
   * chat, a drag from one channel into another. A paste of one picture brings its bitmap along, and
   * that is the preview; anything else is fetched from the store, so the entry is a file like any
   * other and an upload is still possible should the copy be refused.
   */
  async function addReferences(
    refs: AttachmentRef[],
    bytes: FileList | File[] | null | undefined,
    origin: LinkOrigin,
  ): Promise<string[]> {
    const errors: string[] = [];
    const carried = bytes ? Array.from(bytes) : [];

    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const local = carried.length === refs.length ? carried[i] : null;
      const file = local ? renamed(local, ref) : await fetchAsFile(ref.fileId, ref.fileName, ref.contentType);

      if (!file) {
        errors.push(`Could not read ${ref.fileName ?? ref.fileId}`);
        continue;
      }

      const err = validateFile(file);
      if (err) {
        errors.push(err);
        continue;
      }

      const entry: PendingAttachment = {
        file,
        previewUrl: null,
        thumbHash: ref.thumbHash,
        width: ref.width,
        height: ref.height,
        progress: 0,
        status: "pending",
        sha256: null,
        link: { fileId: ref.fileId, fileName: ref.fileName, origin },
      };

      await describe(entry, { dimensions: ref.width == null || ref.height == null, thumbHash: !ref.thumbHash });

      pendingFiles.value.push(entry);
    }

    return errors;
  }

  function renamed(local: File, ref: AttachmentRef): File {
    const name = ref.fileName ?? local.name;
    return name === local.name ? local : new File([local], name, { type: local.type || ref.contentType || "application/octet-stream" });
  }

  async function fetchAsFile(fileId: Guid, fileName: string | null, contentType: string | null): Promise<File | null> {
    try {
      const resp = await fetch(cdnFetchUrl(fileId));
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return new File([blob], fileName ?? "file", { type: contentType || blob.type || "application/octet-stream" });
    } catch (e) {
      logger.warn("Could not fetch a referenced file:", e);
      return null;
    }
  }

  /** Releases what an entry holds: a pending render, its poster, its preview. */
  function dispose(entry: PendingAttachment, { revokePreview = true }: { revokePreview?: boolean } = {}) {
    if (entry.video) {
      const raw = toRaw(entry);
      generations.set(raw, (generations.get(raw) ?? 0) + 1);
      dropRender(entry.video);
      entry.video.poster = null;
    }
    if (revokePreview && entry.previewUrl) {
      URL.revokeObjectURL(entry.previewUrl);
      entry.previewUrl = null;
    }
  }

  function removeFile(index: number) {
    const entry = pendingFiles.value[index];
    if (entry) dispose(entry);
    pendingFiles.value.splice(index, 1);
  }

  /**
   * Puts other bytes in an entry's place (an edited picture, an editor's render): everything known
   * about the old bytes goes — hash, link, placeholder, video state — and the new ones are described
   * as if just added. `known` carries what the caller already has (a preview, the size).
   */
  async function replaceFile(index: number, file: File, known: { previewUrl?: string | null; width?: number | null; height?: number | null } = {}) {
    const entry = pendingFiles.value[index];
    if (!entry) return;
    dispose(entry);
    entry.file = file;
    entry.previewUrl = known.previewUrl ?? null;
    entry.width = known.width ?? null;
    entry.height = known.height ?? null;
    entry.thumbHash = null;
    entry.sha256 = null;
    entry.link = null;
    entry.video = undefined;
    entry.status = "pending";
    entry.progress = 0;
    entry.error = undefined;
    entry.result = undefined;

    if (isVideoFile(file)) {
      const preview = entry.previewUrl;
      entry.previewUrl = null;
      if (await describeVideo(entry)) {
        if (preview) URL.revokeObjectURL(preview);
        void refreshPlan(entry);
        return;
      }
      entry.previewUrl = preview;
    }

    await describe(entry, { dimensions: entry.width == null || entry.height == null, thumbHash: true });
    entry.sha256 = await hashOf(file);
  }

  /** A copy of the linked file in the target, or null when the server would rather have the bytes. */
  async function attachExisting(entry: PendingAttachment, target: UploadTarget): Promise<AttachmentInfo | null> {
    const link = entry.link!;
    const name = link.fileName ?? entry.file.name ?? null;

    try {
      const result: IAttachExistingFileResult = target.kind === "dm"
        ? await api.userChatInteractions.AttachExistingFile(target.peerId, link.fileId, name)
        : await api.channelInteraction.AttachExistingFile(target.spaceId, target.channelId, link.fileId, name);

      if (result.isSuccessAttachExistingFile()) return result.info;

      if (result.isFailedAttachExistingFile()) {
        logger.info("Attaching an existing file was refused:", result.error);
        // A pooled file the server no longer has is not offered again.
        if (result.error === AttachExistingFileError.SOURCE_NOT_FOUND && link.origin === "pool" && entry.sha256)
          await forgetUpload(entry.sha256);
      }
      return null;
    } catch (e) {
      // An older server has no such method; the bytes go the long way.
      logger.warn("Attaching an existing file failed:", e);
      return null;
    }
  }

  async function remember(entry: PendingAttachment) {
    if (!entry.sha256 || !entry.result) return;
    try {
      await rememberUpload({
        sha256: entry.sha256,
        fileId: entry.result.fileId,
        fileName: entry.result.fileName,
        fileSize: Number(entry.result.fileSize),
        contentType: entry.result.contentType,
        width: entry.width,
        height: entry.height,
        thumbHash: entry.thumbHash,
      });
    } catch (e) {
      logger.debug("upload pool write skipped", e);
    }
  }

  async function uploadSingleFile(
    entry: PendingAttachment,
    target: UploadTarget,
  ): Promise<void> {
    entry.status = "uploading";
    entry.progress = 0;

    const kind = isImageType(entry.file.type) ? "image" : isVideoType(entry.file.type) ? "video" : "other";

    if (entry.link) {
      const linked = await attachExisting(entry, target);
      if (linked) {
        entry.result = linked;
        entry.progress = 100;
        entry.status = "done";
        metrics.count("attachment.dedup", { kind, source: entry.link.origin, result: "linked" });
        await remember(entry);
        return;
      }

      metrics.count("attachment.dedup", { kind, source: entry.link.origin, result: "fallback" });

      // A pasted bitmap is a re-encoding of the original; the store still has the original itself.
      if (entry.link.origin !== "pool") {
        const original = await fetchAsFile(entry.link.fileId, entry.link.fileName ?? entry.file.name, null);
        if (original) entry.file = original;
      }
    }

    const uploadTimer = metrics.startTimer("attachment.upload.duration", { kind });
    metrics.distribution("attachment.bytes", entry.file.size, "byte", { kind });

    try {
      // Step 1: describe the bytes and ask for a ticket. A server that already holds them where this
      // account can see answers with a copy instead, and the bytes never leave the device.
      const begin = await beginUpload(entry, target);

      if (begin.existing) {
        entry.result = begin.existing;
        entry.progress = 100;
        entry.status = "done";
        uploadTimer.end({ result: "ok" });
        metrics.count("attachment.dedup", { kind, source: "server", result: "linked" });
        await remember(entry);
        return;
      }

      entry.progress = 20;

      // Step 2: Upload file via PUT
      const { blobId } = await uploadFile(begin.ticket, entry.file, "Attachment");

      entry.progress = 80;

      // Step 3: Complete upload
      const info = target.kind === "dm"
        ? await api.userChatInteractions.CompleteUploadAttachment(target.peerId, blobId)
        : await api.channelInteraction.CompleteUploadAttachment(target.spaceId, target.channelId, blobId);

      entry.result = info;
      entry.progress = 100;
      entry.status = "done";
      uploadTimer.end({ result: "ok" });
      metrics.count("attachment.upload", { kind, result: "ok" });
      await remember(entry);
    } catch (e: any) {
      entry.status = "error";
      entry.error = e?.message ?? "Upload failed";
      logger.error("Attachment upload failed:", e);
      uploadTimer.end({ result: "failed", error: errorKind(e) });
      metrics.count("attachment.upload", { kind, result: "failed", error: errorKind(e) });
    }
  }

  // ── Sending a video: compress (one at a time), then upload ─────────────────────────────────────

  /** The storyboard of what is sent; from the source when the output cannot be decoded here and its frames are the source's. */
  async function storyboardOf(entry: PendingAttachment, lib: VideoLib, prepared: PreparedVideo): Promise<VideoStoryboardSprite | null> {
    try {
      return await lib.buildStoryboard(prepared.blob, prepared.durationMs);
    } catch (e) {
      const v = entry.video!;
      if (entry.file !== v.source || videoIsEdited(v.prefs)) {
        logger.debug("storyboard skipped", e);
        return null;
      }
      try {
        return await lib.buildStoryboard(toRaw(entry.file), prepared.durationMs);
      } catch (e2) {
        logger.debug("storyboard skipped", e2);
        return null;
      }
    }
  }

  /**
   * The compress part of a send, run in the queue: the editor's render when there is one (its output
   * replaces the bytes), the plan, the preparation within the target's limit, the storyboard.
   * `prepared: null` when it goes as a file after all (the plan said so); throws on a failure.
   */
  async function compress(entry: PendingAttachment, report: (phase: VideoSendPhase, value: number) => void): Promise<Compressed> {
    const v = entry.video!;
    const context = await videoContext();
    const { lib, encoders } = context;
    let progress: VideoSendProgress | null = null;
    const step = (s: VideoSendStep, phase: VideoSendPhase, fraction: number) => {
      if (progress) report(phase, progress.step(s, fraction));
    };

    const render = v.render;
    if (render) {
      v.render = null;
      progress = new VideoSendProgress("transcode", true);
      const stop = render.creationProgress
        ? watch(() => render.creationProgress!.value, (f) => step("render", "render", f), { immediate: true })
        : () => {};
      let payload: Awaited<ReturnType<VideoRender["getResult"]>>;
      try {
        payload = await render.getResult();
      } catch (e) {
        throw new VideoRenderError(e instanceof Error ? e.message : String(e), { cause: e });
      } finally {
        stop();
      }
      step("render", "render", 1);
      const file = new File([payload.blob], mp4Name(v.source.name), { type: "video/mp4" });
      v.probe = markRaw(await lib.probeVideo(file));
      entry.file = file;
      // The render's cover goes up as the poster; the bubble keeps the preview it already shows.
      const cover = payload.thumb ? await posterFromImage(payload.thumb.blob) : null;
      if (cover) v.poster = markRaw(cover);
    }

    const plan = applyPlan(entry, context);
    if (!plan) throw new VideoPlanError("The video's edits cannot be planned");
    progress ??= new VideoSendProgress(plan.mode, false);
    if (v.prefs.sendAsFile && !videoIsEdited(v.prefs) && !render) return { prepared: null, progress };

    const result = await lib.prepareWithinLimit(toRaw(entry.file), toRaw(v.probe), videoPrefsOf(v, context.limits), encoders, {
      onProgress: (f) => step("prepare", "prepare", f),
    });
    if (!result.prepared) {
      // Even the lowest rung is too large: a file.
      v.plan = markRaw(result.plan);
      v.fileReason = result.plan.reason ?? "too-large";
      v.prefs.sendAsFile = true;
      return { prepared: null, progress };
    }
    v.plan = markRaw(result.plan);
    step("prepare", "prepare", 1);
    const storyboard = await storyboardOf(entry, lib, result.prepared);
    step("storyboard", "prepare", 1);
    return { prepared: result.prepared, storyboard, progress };
  }

  async function uploadPreparedVideo(
    entry: PendingAttachment,
    compressed: Extract<Compressed, { prepared: PreparedVideo }>,
    target: UploadTarget,
    report: (phase: VideoSendPhase, value: number) => void,
  ): Promise<void> {
    const lib = videoLib ?? (await loadVideoLib());
    const v = entry.video!;
    const { prepared, storyboard, progress } = compressed;
    const UPLOAD_STEPS: Record<string, VideoSendStep> = { poster: "poster-upload", storyboard: "storyboard-upload", video: "upload" };
    entry.status = "uploading";
    entry.progress = 0;
    try {
      report("upload", progress.value);
      const info = await lib.uploadVideo(
        target,
        { ...prepared, fileName: v.source.name, poster: v.poster ? toRaw(v.poster) : null, storyboard },
        {
          onProgress: (stage, fraction) => {
            if (stage === "video") entry.progress = Math.round(fraction * 100);
            report("upload", progress.step(UPLOAD_STEPS[stage] ?? "upload", fraction));
          },
        },
      );
      entry.entity = markRaw(lib.videoEntityOf(info));
      entry.progress = 100;
      entry.status = "done";
      report("upload", progress.finish());
    } catch (e: any) {
      entry.status = "error";
      entry.error = e?.message ?? "Upload failed";
      entry.failure = markRaw(e);
      logger.error("Video upload failed:", e);
      // The server refused what its limits, as known here, allowed: ask it again next time.
      const code = (e as { code?: unknown })?.code;
      if (code === VideoUploadError.TOO_LARGE || code === VideoUploadError.TOO_LONG) invalidateUploadLimits(target);
    }
  }

  /**
   * One entry of a send: a video as a video (compressed in the queue, then uploaded with its poster
   * and storyboard), or anything else — a video sent as a file included — as an attachment.
   */
  async function sendEntry(entry: PendingAttachment, target: UploadTarget, report?: VideoSendReporter): Promise<void> {
    const v = entry.video;
    const toBubble = (phase: VideoSendPhase, value: number | null) => report?.(optimisticOf.get(toRaw(entry)), phase, value);

    if (v && (!v.prefs.sendAsFile || videoIsEdited(v.prefs) || v.render)) {
      entry.status = "uploading";
      // Waiting for the videos ahead of it reads as the start of its compressing.
      toBubble(v.render ? "render" : "prepare", 0);
      let compressed: Compressed;
      try {
        compressed = await inPrepareQueue(() => compress(entry, toBubble));
      } catch (e: any) {
        entry.status = "error";
        entry.error = e?.message ?? "Preparation failed";
        entry.failure = markRaw(e);
        logger.error("Video preparation failed:", e);
        return;
      }
      if (compressed.prepared && !v.prefs.sendAsFile) return uploadPreparedVideo(entry, compressed, target, toBubble);
      // Sent as a file with its edits: the prepared MP4 is the file.
      if (compressed.prepared) entry.file = new File([compressed.prepared.blob], mp4Name(v.source.name), { type: "video/mp4" });
    }

    if (v) {
      const lib = videoLib ?? (await loadVideoLib());
      // The metric's reason: the plan's, else why it was forced to a file ("too-long"), else the user's choice.
      const reason = (v.plan?.reason ?? v.fileReason ?? "user-original") as VideoOriginalReason;
      if (v.plan) lib.recordVideoSentAsFile({ ...toRaw(v.plan), reason });
      entry.sha256 ??= await hashOf(toRaw(entry.file));
    }
    return uploadSingleFile(entry, target);
  }

  /**
   * The ticket for an upload, or the copy the server made instead. With a hash in hand the server is
   * told what is coming (PrepareUploadAttachment); without one, or against a server that predates it,
   * the plain BeginUploadAttachment is what it always was.
   */
  async function beginUpload(
    entry: PendingAttachment,
    target: UploadTarget,
  ): Promise<{ ticket: IUploadFileResult; existing?: undefined } | { ticket?: undefined; existing: AttachmentInfo }> {
    if (entry.sha256) {
      let prepared: IPrepareUploadResult | null = null;
      try {
        const sha = hexToBytes(entry.sha256);
        const size = BigInt(entry.file.size);
        const type = entry.file.type || "application/octet-stream";
        prepared = target.kind === "dm"
          ? await api.userChatInteractions.PrepareUploadAttachment(target.peerId, sha, size, type, entry.file.name)
          : await api.channelInteraction.PrepareUploadAttachment(target.spaceId, target.channelId, sha, size, type, entry.file.name);
      } catch (e) {
        logger.warn("PrepareUploadAttachment failed; falling back to BeginUploadAttachment:", e);
      }

      if (prepared?.isAlreadyStored()) return { existing: prepared.info };
      if (prepared?.isUploadRequired())
        return { ticket: new SuccessUploadFile(prepared.blobId, prepared.uploadUrl, prepared.formFields, prepared.ttlSeconds) };
      if (prepared?.isFailedPrepareUpload())
        throw new Error(PrepareUploadError[prepared.error] ?? "PrepareUploadAttachment failed");
    }

    const begin = target.kind === "dm"
      ? await api.userChatInteractions.BeginUploadAttachment(target.peerId)
      : await api.channelInteraction.BeginUploadAttachment(target.spaceId, target.channelId);

    return { ticket: begin };
  }

  function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function entityOf(entry: PendingAttachment, result: AttachmentInfo): MessageEntityAttachment {
    return new MessageEntityAttachment(
      EntityType.Attachment,
      0,
      0,
      1,
      result.fileId,
      result.fileName,
      result.fileSize,
      result.contentType,
      entry.width,
      entry.height,
      entry.thumbHash,
      null,
    );
  }

  /** What a sent batch carries, in the order it was attached. */
  function sentEntities(entries: PendingAttachment[]): IMessageEntity[] {
    const entities: IMessageEntity[] = [];
    for (const entry of entries) {
      if (entry.status !== "done") continue;
      if (entry.entity) entities.push(entry.entity);
      else if (entry.result) entities.push(entityOf(entry, entry.result));
    }
    return entities;
  }

  async function sendEntries(entries: PendingAttachment[], target: UploadTarget, report?: VideoSendReporter): Promise<IMessageEntity[]> {
    const pending = entries.filter((f) => f.status !== "done");
    await Promise.all(pending.map((entry) => sendEntry(entry, target, report)));
    return sentEntities(entries);
  }

  async function uploadAll(target: UploadTarget, report?: VideoSendReporter): Promise<IMessageEntity[]> {
    return sendEntries(pendingFiles.value, target, report);
  }

  function clear() {
    for (const entry of pendingFiles.value) dispose(entry);
    pendingFiles.value = [];
  }

  // Files staged in a composer that unmounts (channel switch, space closed) used to stay pinned by
  // their object URLs with nothing left to revoke them — up to ten 8 MB blobs per abandoned draft.
  // A send in flight is unaffected: detach() has already moved its entries out of pendingFiles.
  if (getCurrentScope()) onScopeDispose(() => clear());

  function hasErrors(): boolean {
    return pendingFiles.value.some((f) => f.status === "error");
  }

  /** The bubble of a video while it is compressed and uploaded: what the plan expects of it. */
  function optimisticVideoEntity(entry: PendingAttachment): IMessageEntity {
    const v = entry.video!;
    const plan = v.plan;
    const expected: PreparedVideo = {
      blob: new Blob([], { type: "video/mp4" }),
      width: plan?.width ?? v.probe.width,
      height: plan?.height ?? v.probe.height,
      durationMs: plan?.durationMs ?? v.probe.durationMs,
      hasAudio: plan ? plan.audio !== "none" : v.probe.hasAudio && !v.prefs.mute,
      codecString: null,
      mode: plan?.mode === "copy" || plan?.mode === "remux" ? plan.mode : "transcode",
    };
    const entity = videoLib!.videoEntityFromOptimistic(
      { ...expected, fileName: v.source.name },
      v.poster ? toRaw(v.poster) : null,
      { posterUrl: entry.previewUrl },
    );
    if (plan) entity.fileSize = BigInt(plan.estimatedBytes);
    return entity;
  }

  function buildOptimisticEntities(): IMessageEntity[] {
    const PLACEHOLDER_FILE_ID = "00000000-0000-0000-0000-000000000000";
    return pendingFiles.value.map((entry) => {
      const entity = goesAsVideo(entry) && videoLib
        ? optimisticVideoEntity(entry)
        : new MessageEntityAttachment(
            EntityType.Attachment,
            0,
            0,
            1,
            PLACEHOLDER_FILE_ID,
            entry.file.name,
            BigInt(entry.file.size),
            entry.file.type || "application/octet-stream",
            entry.width,
            entry.height,
            entry.thumbHash,
            null,
          );
      optimisticOf.set(toRaw(entry), entity);
      return entity;
    });
  }

  /**
   * Detach current pending files from the composable for background upload.
   * Returns a standalone uploader that owns the snapshot.
   * The composable is cleared immediately so new files can be added.
   */
  function detach() {
    const snapshot = [...pendingFiles.value];
    // Clear composable without revoking previewUrls (snapshot still needs them)
    pendingFiles.value = [];

    return {
      files: snapshot,
      hasFiles: snapshot.length > 0,
      /** Whether any of it goes out as a video. */
      hasVideo: snapshot.some(goesAsVideo),
      /** The optimistic entity shown for each file, by position, as buildOptimisticEntities made them. */
      optimisticEntities: () => snapshot.map((entry) => optimisticOf.get(toRaw(entry))).filter((e): e is IMessageEntity => !!e),
      async uploadAll(target: UploadTarget, report?: VideoSendReporter): Promise<IMessageEntity[]> {
        return sendEntries(snapshot, target, report);
      },
      hasErrors(): boolean {
        return snapshot.some((f) => f.status === "error");
      },
      /** What stopped the first video that failed, for its message; null when none did. */
      videoFailure(): unknown {
        return snapshot.find((f) => f.status === "error" && f.failure !== undefined)?.failure ?? null;
      },
      /** Releases what the send holds; the previews (shown by the optimistic bubbles) after `previewsAfterMs`. */
      cleanup(previewsAfterMs = 0) {
        const previews: string[] = [];
        for (const entry of snapshot) {
          if (entry.previewUrl) previews.push(entry.previewUrl);
          dispose(entry, { revokePreview: false });
        }
        const revoke = () => previews.forEach((url) => URL.revokeObjectURL(url));
        if (previewsAfterMs > 0) setTimeout(revoke, previewsAfterMs);
        else revoke();
      },
    };
  }

  return {
    pendingFiles,
    hasFiles,
    isUploading,
    addFiles,
    addReferences,
    removeFile,
    replaceFile,
    uploadAll,
    clear,
    hasErrors,
    buildOptimisticEntities,
    detach,
    setVideoPrefs,
    applyVideoEdit,
    renderVideoEdit,
  };
}
