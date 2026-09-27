import { ExpressionFormat, ExpressionKind } from "@argon/glue";
import { decodeLottieBytes, LottieTooLargeError } from "./lottie/decode";
import { dimensionsFit, EXPRESSION_LIMITS, maxBytes } from "./limits";
import { lottieFirstFrame, probeVideo, snapshotFrame, videoFirstFrame } from "./firstFrame";

export {
  associatedEmojiError,
  dimensionsFit,
  extractEmoji,
  itemNameError,
  keywordsError,
  maxBytes,
  packSlugError,
  packTitleError,
  slugify,
  suggestItemName,
} from "./limits";

// What an upload is checked against before any byte leaves the machine: the file's real type (by
// its magic bytes, not its name), its size for that type, its canvas and, for animations, its length.
// The server checks all of it again; this only turns its refusals into early, specific messages.

export type SniffedType = "png" | "webp" | "tgs" | "json" | "webm" | "unknown";

export const EXPRESSION_CONTENT_TYPES: Record<Exclude<SniffedType, "unknown">, string> = {
  png: "image/png",
  webp: "image/webp",
  tgs: "application/x-tgsticker",
  json: "application/json",
  webm: "video/webm",
};

/** A refusal with its i18n key and the values the message needs. */
export interface UploadRejection {
  rejected: true;
  key: string;
  params?: Record<string, string | number>;
}

export const isRejection = (value: unknown): value is UploadRejection =>
  !!value && typeof value === "object" && (value as UploadRejection).rejected === true;

const reject = (key: string, params?: Record<string, string | number>): UploadRejection => ({ rejected: true, key, params });

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) =>
  bytes.length >= at + prefix.length && prefix.every((b, i) => bytes[at + i] === b);

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

/** The file type by its first bytes. */
export function sniffType(bytes: Uint8Array): SniffedType {
  if (startsWith(bytes, PNG_MAGIC)) return "png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp";
  if (startsWith(bytes, [0x1f, 0x8b])) return "tgs";
  if (startsWith(bytes, EBML_MAGIC)) {
    // The DocType sits in the EBML header, within its first few dozen bytes.
    const head = String.fromCharCode(...bytes.subarray(0, 64));
    return head.includes("webm") ? "webm" : "unknown";
  }
  let i = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return bytes[i] === 0x7b ? "json" : "unknown";
}

export function formatOf(type: SniffedType): ExpressionFormat | null {
  switch (type) {
    case "png":
    case "webp":
      return ExpressionFormat.Static;
    case "tgs":
    case "json":
      return ExpressionFormat.Lottie;
    case "webm":
      return ExpressionFormat.Video;
    default:
      return null;
  }
}

export interface ImageHeader {
  width: number;
  height: number;
  animated: boolean;
}

const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** Size from IHDR; animated when an `acTL` chunk comes before the image data (APNG). */
export function pngHeader(bytes: Uint8Array): ImageHeader | null {
  if (!startsWith(bytes, PNG_MAGIC) || bytes.length < 24 || !startsWith(bytes, ascii("IHDR"), 12)) return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  let animated = false;
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = u32be(bytes, at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === "acTL") animated = true;
    if (type === "IDAT" || type === "IEND") break;
    at += 12 + length;
  }
  return { width, height, animated };
}

/** Size from the VP8 / VP8L / VP8X chunk; VP8X says whether it is animated. */
export function webpHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 30 || !startsWith(bytes, ascii("RIFF")) || !startsWith(bytes, ascii("WEBP"), 8)) return null;
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  const data = 20;
  if (chunk === "VP8X") {
    return {
      width: u24le(bytes, data + 4) + 1,
      height: u24le(bytes, data + 7) + 1,
      animated: (bytes[data] & 0x02) !== 0,
    };
  }
  if (chunk === "VP8L") {
    if (bytes[data] !== 0x2f) return null;
    const bits = u32le(bytes, data + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, animated: false };
  }
  if (chunk === "VP8 ") {
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], data + 3)) return null;
    return {
      width: (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff,
      height: (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff,
      animated: false,
    };
  }
  return null;
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round((bytes / 1024) * 10) / 10} KB`;
}

/** The size cap for this kind and type. A plain-JSON Lottie is judged later, by its gzipped size. */
export function checkSize(kind: ExpressionKind, type: SniffedType, size: number): UploadRejection | null {
  const format = formatOf(type);
  if (format === null) return reject("expression_settings_upload_error_type");
  const limit = type === "json" ? EXPRESSION_LIMITS.lottieMaxJsonBytes : maxBytes(kind, format);
  return size > limit ? reject("expression_settings_upload_error_size", { size: formatBytes(size), max: formatBytes(limit) }) : null;
}

export function checkDimensions(kind: ExpressionKind, format: ExpressionFormat, width: number, height: number): UploadRejection | null {
  if (dimensionsFit(kind, format, width, height)) return null;
  const key =
    kind === ExpressionKind.Emoji
      ? "expression_settings_upload_error_dims_emoji"
      : format === ExpressionFormat.Lottie
        ? "expression_settings_upload_error_dims_lottie"
        : "expression_settings_upload_error_dims_sticker";
  return reject(key, { width, height });
}

export function checkDuration(seconds: number | null | undefined): UploadRejection | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  // One timestamp tick of slack, as the server allows.
  return seconds > EXPRESSION_LIMITS.maxDurationSeconds + 0.001
    ? reject("expression_settings_upload_error_duration", { seconds: Math.round(seconds * 100) / 100 })
    : null;
}

// ── Lottie ──────────────────────────────────────────────────────────────────────────────────────

type Scope = "other" | "root" | "layer" | "asset" | "shape";
type Json = Record<string, unknown>;

const LOTTIE_MAX_DEPTH = 64;

const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const num = (obj: Json, name: string): number | null => (typeof obj[name] === "number" ? (obj[name] as number) : null);
const flag = (obj: Json, name: string) => obj[name] === true || (typeof obj[name] === "number" && obj[name] !== 0);
const nonEmptyArray = (obj: Json, name: string) => Array.isArray(obj[name]) && (obj[name] as unknown[]).length > 0;

function childScope(parent: Scope, name: string): Scope {
  if (parent === "root" && name === "layers") return "layer";
  if (parent === "root" && name === "assets") return "asset";
  if (parent === "asset" && name === "layers") return "layer";
  if (parent === "layer" && name === "shapes") return "shape";
  if (parent === "shape" && name === "it") return "shape";
  return "other";
}

/** The server's LottieInspector: what Telegram forbids in a sticker animation. */
function allowed(obj: Json, scope: Scope): boolean {
  // Expressions: an animated property carrying script in "x".
  if (typeof obj.x === "string") return false;
  switch (scope) {
    case "root":
      return !flag(obj, "ddd");
    case "layer": {
      // 1 solid, 2 image, 5 text, 6 audio, 13 camera.
      const type = num(obj, "ty");
      if (type !== null && [1, 2, 5, 6, 13].includes(type)) return false;
      if (flag(obj, "ddd") || flag(obj, "ao") || flag(obj, "hasMask")) return false;
      if ("tm" in obj) return false;
      if (nonEmptyArray(obj, "masksProperties") || nonEmptyArray(obj, "ef")) return false;
      const stretch = num(obj, "sr");
      return stretch === null || stretch === 1;
    }
    case "asset":
      // Image assets carry a path ("p"), embedded ones also "e": 1; precomps carry "layers".
      return !("p" in obj) && !flag(obj, "e");
    case "shape":
      return !(typeof obj.ty === "string" && ["gs", "rp", "mm", "sr"].includes(obj.ty));
    default:
      return true;
  }
}

function walk(root: Json): boolean {
  const stack: [unknown, Scope, number][] = [[root, "root", 1]];
  while (stack.length) {
    const [element, scope, depth] = stack.pop()!;
    if (depth > LOTTIE_MAX_DEPTH) return false;
    if (Array.isArray(element)) {
      // Elements of an array share the array's scope ("layers": [...] holds layers).
      for (const child of element) if (child && typeof child === "object") stack.push([child, scope, depth + 1]);
      continue;
    }
    if (!isObject(element) || !allowed(element, scope)) return false;
    for (const [name, value] of Object.entries(element)) {
      if (value && typeof value === "object") stack.push([value, childScope(scope, name), depth + 1]);
    }
  }
  return true;
}

export interface LottieInfo {
  width: number;
  height: number;
  duration: number;
  fps: number;
}

/** Canvas, frame rate, length and the forbidden features, as the server checks them. */
export function inspectLottieJson(json: unknown, kind: ExpressionKind): LottieInfo | UploadRejection {
  if (!isObject(json)) return reject("expression_settings_upload_error_lottie_invalid");
  const w = num(json, "w");
  const h = num(json, "h");
  const fr = num(json, "fr");
  const ip = num(json, "ip");
  const op = num(json, "op");
  if (w === null || h === null || fr === null || ip === null || op === null || !Array.isArray(json.layers)) {
    return reject("expression_settings_upload_error_lottie_invalid");
  }
  const dims = checkDimensions(kind, ExpressionFormat.Lottie, w, h);
  if (dims) return dims;
  if (!(fr > 0) || fr > EXPRESSION_LIMITS.lottieMaxFps) return reject("expression_settings_upload_error_fps", { max: EXPRESSION_LIMITS.lottieMaxFps });
  if (!(op > ip)) return reject("expression_settings_upload_error_lottie_invalid");
  const duration = (op - ip) / fr;
  if (duration > EXPRESSION_LIMITS.maxDurationSeconds + 1e-9) return reject("expression_settings_upload_error_duration", { seconds: Math.round(duration * 100) / 100 });
  if (!walk(json)) return reject("expression_settings_upload_error_lottie_features");
  return { width: w, height: h, duration, fps: fr };
}

// ── the whole file ──────────────────────────────────────────────────────────────────────────────

export interface InspectedFile {
  type: Exclude<SniffedType, "unknown">;
  format: ExpressionFormat;
  /** What is uploaded: the file itself, or a plain-JSON Lottie gzipped into a TGS. */
  file: Blob;
  contentType: string;
  width: number;
  height: number;
  /** TGS / JSON bytes, for rendering the first frame. */
  lottieBytes?: ArrayBuffer;
}

async function gzip(bytes: Uint8Array): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") return null;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], { type: EXPRESSION_CONTENT_TYPES.tgs });
}

/** Type, size, canvas and length of a file dropped for `kind`; every check runs locally. */
export async function inspectExpressionFile(file: Blob, kind: ExpressionKind): Promise<InspectedFile | UploadRejection> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const type = sniffType(bytes);
  const format = formatOf(type);
  if (type === "unknown" || format === null) return reject("expression_settings_upload_error_type");
  const tooLarge = checkSize(kind, type, bytes.length);
  if (tooLarge) return tooLarge;

  if (type === "png" || type === "webp") {
    const header = type === "png" ? pngHeader(bytes) : webpHeader(bytes);
    if (!header) return reject("expression_settings_upload_error_corrupt");
    if (header.animated) return reject("expression_settings_upload_error_animated_image");
    const dims = checkDimensions(kind, format, header.width, header.height);
    if (dims) return dims;
    if (typeof createImageBitmap === "function") {
      try {
        (await createImageBitmap(new Blob([bytes], { type: EXPRESSION_CONTENT_TYPES[type] }))).close();
      } catch {
        return reject("expression_settings_upload_error_corrupt");
      }
    }
    return { type, format, file, contentType: EXPRESSION_CONTENT_TYPES[type], width: header.width, height: header.height };
  }

  if (type === "tgs" || type === "json") {
    let json: unknown;
    try {
      json = JSON.parse(await decodeLottieBytes(bytes, EXPRESSION_LIMITS.lottieMaxJsonBytes));
    } catch (e) {
      return e instanceof LottieTooLargeError
        ? reject("expression_settings_upload_error_size", { size: formatBytes(bytes.length), max: formatBytes(maxBytes(kind, format)) })
        : reject("expression_settings_upload_error_lottie_invalid");
    }
    const info = inspectLottieJson(json, kind);
    if (isRejection(info)) return info;

    let upload: Blob = file;
    let uploadType: "tgs" | "json" = type;
    if (type === "json") {
      // The server gzips plain JSON and holds the result to the TGS cap; do the same here and send
      // the smaller file.
      const packed = await gzip(bytes).catch(() => null);
      if (packed) {
        const cap = maxBytes(kind, format);
        if (packed.size > cap) return reject("expression_settings_upload_error_size", { size: formatBytes(packed.size), max: formatBytes(cap) });
        upload = packed;
        uploadType = "tgs";
      }
    }
    return {
      type: uploadType,
      format,
      file: upload,
      contentType: EXPRESSION_CONTENT_TYPES[uploadType],
      width: info.width,
      height: info.height,
      lottieBytes: buffer,
    };
  }

  // WEBM: the element reads the canvas and the length. Whether there is sound, or the codec is VP9,
  // is left to the server: a browser cannot say reliably.
  const meta = await probeVideo(file).catch(() => null);
  if (!meta) return reject("expression_settings_upload_error_video");
  const dims = checkDimensions(kind, format, meta.width, meta.height);
  if (dims) return dims;
  const long = checkDuration(meta.duration);
  if (long) return long;
  return { type, format, file, contentType: EXPRESSION_CONTENT_TYPES.webm, width: meta.width, height: meta.height };
}

export interface PreparedUpload extends InspectedFile {
  /** A WEBP of the first frame at the item's own size (animations only). */
  thumb: Blob | null;
  /** Traced from the first frame (animations only; a static file is traced by the server). */
  outline: Uint8Array | null;
}

/** `inspectExpressionFile`, then for an animation its first frame as a WEBP and its outline. */
export async function prepareExpressionUpload(file: Blob, kind: ExpressionKind): Promise<PreparedUpload | UploadRejection> {
  const inspected = await inspectExpressionFile(file, kind);
  if (isRejection(inspected)) return inspected;
  if (inspected.format === ExpressionFormat.Static) return { ...inspected, thumb: null, outline: null };

  let frame: CanvasImageSource | null = null;
  let release = () => {};
  try {
    if (inspected.format === ExpressionFormat.Lottie && inspected.lottieBytes) {
      const bitmap = await lottieFirstFrame(inspected.lottieBytes, inspected.width, inspected.height);
      frame = bitmap;
      release = () => bitmap.close();
    } else if (inspected.format === ExpressionFormat.Video) {
      const video = await videoFirstFrame(inspected.file);
      frame = video.element;
      release = video.release;
    }
  } catch {
    frame = null;
  }

  // Without a first frame the item still uploads; it shows its file until it loads.
  if (!frame) {
    release();
    return { ...inspected, thumb: null, outline: null };
  }
  try {
    const { thumb, outline } = await snapshotFrame(frame, inspected.width, inspected.height, EXPRESSION_LIMITS.thumbMaxBytes);
    return { ...inspected, thumb, outline };
  } finally {
    release();
  }
}
