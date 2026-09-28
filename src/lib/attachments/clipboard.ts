import type { Guid } from "@argon-chat/ion.webcore";
import type { MessageEntityAttachment } from "@argon/glue";
import { logger } from "@argon/core";
import { cdnFetchUrl } from "@/store/system/fileStorage";
import { useConfig } from "@/store/system/remoteConfig";

/**
 * A file already on the server, carried through the clipboard or a drag so a paste sends a copy of
 * it rather than its bytes.
 *
 * Three ways it travels. Our own type on a `DataTransfer` (drag, and a `copy` event); the same JSON
 * under Chromium's `web ` prefix in the async clipboard; and the `text/html` every "Copy image" puts
 * on the clipboard — the browser's own as much as ours — whose `<img src>` names the file by its
 * `/files/{id}` address. The HTML is what makes a native right-click copy on the web a copy of the
 * file instead of a re-encoded PNG upload.
 */
export const ATTACHMENT_CLIPBOARD_TYPE = "application/x-argon-attachment";
export const ATTACHMENT_WEB_CLIPBOARD_TYPE = `web ${ATTACHMENT_CLIPBOARD_TYPE}`;

export interface AttachmentRef {
  fileId: Guid;
  fileName: string | null;
  fileSize: number | null;
  contentType: string | null;
  width: number | null;
  height: number | null;
  thumbHash: string | null;
}

const GUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const GUID_ONLY = new RegExp(`^${GUID}$`, "i");

export function refOf(a: MessageEntityAttachment): AttachmentRef {
  return {
    fileId: a.fileId,
    fileName: a.fileName || null,
    fileSize: a.fileSize == null ? null : Number(a.fileSize),
    contentType: a.contentType || null,
    width: a.width ?? null,
    height: a.height ?? null,
    thumbHash: a.thumbHash ?? null,
  };
}

export function serializeRefs(refs: AttachmentRef[]): string {
  return JSON.stringify({ v: 1, files: refs });
}

/** The refs in a payload of ours, or none when it is not one. Every field is checked: it came off the clipboard. */
export function parseRefsJson(json: string | null | undefined): AttachmentRef[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json) as { v?: unknown; files?: unknown };
    if (data.v !== 1 || !Array.isArray(data.files)) return [];
    const out: AttachmentRef[] = [];
    for (const f of data.files as Record<string, unknown>[]) {
      if (!f || typeof f.fileId !== "string" || !GUID_ONLY.test(f.fileId)) continue;
      out.push({
        fileId: f.fileId.toLowerCase(),
        fileName: typeof f.fileName === "string" && f.fileName ? f.fileName : null,
        fileSize: typeof f.fileSize === "number" && f.fileSize >= 0 ? f.fileSize : null,
        contentType: typeof f.contentType === "string" && f.contentType ? f.contentType : null,
        width: typeof f.width === "number" ? f.width : null,
        height: typeof f.height === "number" ? f.height : null,
        thumbHash: typeof f.thumbHash === "string" ? f.thumbHash : null,
      });
    }
    return dedupe(out);
  } catch {
    return [];
  }
}

/** The file id an address names, when it is one of ours on this instance: `{api}/files/{id}`, or the desktop's cache schemes. */
export function fileIdFromUrl(url: string | null | undefined, apiBase: string): Guid | null {
  if (!url) return null;
  const trimmed = url.trim();

  const cached = /^app:\/\/cdn\/([^/?#]+)/i.exec(trimmed);
  if (cached) return GUID_ONLY.test(cached[1]) ? cached[1].toLowerCase() : null;

  const proxied = /^app:\/\/cdn-proxy\/(.+)$/i.exec(trimmed);
  if (proxied) {
    try {
      return fileIdFromUrl(decodeURIComponent(proxied[1]), apiBase);
    } catch {
      return null;
    }
  }

  const base = apiBase.replace(/\/+$/, "").toLowerCase();
  if (!base || !trimmed.toLowerCase().startsWith(`${base}/files/`)) return null;

  const rest = trimmed.slice(base.length + "/files/".length);
  const id = rest.split(/[/?#]/, 1)[0];
  return GUID_ONLY.test(id) ? id.toLowerCase() : null;
}

/** The files a fragment of HTML points at through `<img src>` and `<a href>`. */
export function refsFromHtml(html: string | null | undefined, apiBase: string): AttachmentRef[] {
  if (!html || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: AttachmentRef[] = [];

  for (const img of Array.from(doc.querySelectorAll("img[src]"))) {
    const fileId = fileIdFromUrl(img.getAttribute("src"), apiBase);
    if (fileId) out.push(bare(fileId, img.getAttribute("alt")));
  }
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const fileId = fileIdFromUrl(a.getAttribute("href"), apiBase);
    if (fileId) out.push(bare(fileId, a.getAttribute("download") || a.textContent));
  }

  return dedupe(out);
}

/**
 * The refs a paste or a drop carries, our own type first. HTML is consulted only when the caller
 * says so: a paste that also carries plain text is a copy of a page, and the composer lets its text
 * win, as it does for a file that comes with text.
 */
export function readAttachmentRefs(
  dt: DataTransfer | null | undefined,
  allowHtml: boolean,
  apiBase: string = configuredApiBase(),
): AttachmentRef[] {
  if (!dt) return [];
  const types = Array.from(dt.types ?? []);

  for (const type of [ATTACHMENT_CLIPBOARD_TYPE, ATTACHMENT_WEB_CLIPBOARD_TYPE]) {
    if (!types.includes(type)) continue;
    const refs = parseRefsJson(safeGetData(dt, type));
    if (refs.length) return refs;
  }

  if (allowHtml && types.includes("text/html")) return refsFromHtml(safeGetData(dt, "text/html"), apiBase);

  return [];
}

export function setAttachmentDragData(dt: DataTransfer, refs: AttachmentRef[]): void {
  dt.setData(ATTACHMENT_CLIPBOARD_TYPE, serializeRefs(refs));
  dt.effectAllowed = "copy";
}

/**
 * Puts an attachment on the clipboard so that other apps get a picture (or a link) and a paste back
 * into Argon gets a reference. Images travel as PNG, the one bitmap type the async clipboard takes;
 * no `text/plain`, or the composer would treat the paste as text.
 */
export async function copyAttachmentToClipboard(a: MessageEntityAttachment, apiBase: string = configuredApiBase()): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;

  const url = `${apiBase.replace(/\/+$/, "")}/files/${a.fileId}`;
  const name = a.fileName || (isImageAttachment(a) ? "image" : "file");
  const html = isImageAttachment(a)
    ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(name)}">`
    : `<a href="${escapeAttr(url)}" download="${escapeAttr(name)}">${escapeText(name)}</a>`;

  const payload = new Blob([serializeRefs([refOf(a)])], { type: ATTACHMENT_WEB_CLIPBOARD_TYPE });
  const markup = new Blob([html], { type: "text/html" });

  const attempts: Record<string, Blob | Promise<Blob>>[] = [];
  if (isImageAttachment(a)) {
    const png = pngOf(cdnFetchUrl(a.fileId));
    attempts.push({ "image/png": png, "text/html": markup, [ATTACHMENT_WEB_CLIPBOARD_TYPE]: payload });
    attempts.push({ "image/png": png, "text/html": markup });
  }
  attempts.push({ "text/html": markup, [ATTACHMENT_WEB_CLIPBOARD_TYPE]: payload });
  attempts.push({ "text/html": markup });

  // Custom formats and promise values are Chromium's; each fallback drops what the last refused.
  for (const items of attempts) {
    try {
      await navigator.clipboard.write([new ClipboardItem(items)]);
      return true;
    } catch (e) {
      logger.debug("clipboard write refused, trying a smaller item", e);
    }
  }
  return false;
}

export function isImageAttachment(a: { contentType?: string | null; fileName?: string | null }): boolean {
  if (a.contentType?.startsWith("image/")) return true;
  const ext = a.fileName?.split(".").pop()?.toLowerCase();
  return !!ext && ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ext);
}

/** The bytes of a stored image as PNG, transcoded through a canvas when they are anything else. */
async function pngOf(url: string): Promise<Blob> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);
  const blob = await resp.blob();
  if (blob.type === "image/png") return blob;

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("toBlob failed"))), "image/png"),
    );
  } finally {
    bitmap.close();
  }
}

function bare(fileId: Guid, name: string | null | undefined): AttachmentRef {
  const trimmed = name?.trim();
  return { fileId, fileName: trimmed || null, fileSize: null, contentType: null, width: null, height: null, thumbHash: null };
}

function dedupe(refs: AttachmentRef[]): AttachmentRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.fileId) ? false : (seen.add(r.fileId), true)));
}

function safeGetData(dt: DataTransfer, type: string): string {
  try {
    return dt.getData(type);
  } catch {
    return "";
  }
}

function configuredApiBase(): string {
  try {
    return useConfig().apiEndpoint;
  } catch {
    return "";
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
