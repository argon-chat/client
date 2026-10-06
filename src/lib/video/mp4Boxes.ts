/** One ISO BMFF box: its four-character type, where it starts and how long it is. */
export interface Mp4Box {
  type: string;
  offset: number;
  size: number;
  headerSize: number;
}

/** Enough of a byte source to read box headers from: a Blob, or bytes already in memory. */
export type BoxSource = Blob | Uint8Array;

/** The server looks for `moov` in this many leading bytes. */
export const SERVER_HEAD_BYTES = 64 * 1024;
/** …and refuses (NOT_STREAMABLE) a `moov` that ends beyond this (the server's VideoProbeBytes). */
export const VIDEO_PROBE_BYTES = 32 * 1024 * 1024;

async function readRange(source: BoxSource, start: number, end: number): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source.subarray(start, Math.min(end, source.length));
  return new Uint8Array(await source.slice(start, end).arrayBuffer());
}

const sizeOf = (source: BoxSource) => (source instanceof Uint8Array ? source.length : source.size);

/**
 * The boxes in [start, end) of an MP4/MOV (the whole file by default: its top-level boxes), read
 * header by header (16 bytes each), so a gigabyte `mdat` is skipped rather than read. Stops at the
 * first header that makes no sense, after `maxBoxes`, or when `until` says so.
 */
export async function readBoxes(
  source: BoxSource,
  { start = 0, end, maxBoxes = 64, until }: { start?: number; end?: number; maxBoxes?: number; until?: (box: Mp4Box) => boolean } = {},
): Promise<Mp4Box[]> {
  const total = Math.min(end ?? sizeOf(source), sizeOf(source));
  const boxes: Mp4Box[] = [];
  let offset = start;

  while (offset + 8 <= total && boxes.length < maxBoxes) {
    const head = await readRange(source, offset, Math.min(offset + 16, total));
    if (head.length < 8) break;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = view.getUint32(0);
    const type = String.fromCharCode(head[4], head[5], head[6], head[7]);
    let headerSize = 8;

    if (size === 1) {
      if (head.length < 16) break;
      size = Number(view.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = total - offset;
    }

    if (!/^[\x20-\x7e]{4}$/.test(type) || size < headerSize) break;

    const box = { type, offset, size, headerSize };
    boxes.push(box);
    if (until?.(box)) break;
    offset += size;
  }

  return boxes;
}

/** The top-level boxes of an MP4/MOV. */
export function readTopLevelBoxes(source: BoxSource, options: { maxBoxes?: number; until?: (box: Mp4Box) => boolean } = {}): Promise<Mp4Box[]> {
  return readBoxes(source, options);
}

/**
 * Whether the file can start playing before it is fully downloaded: it opens with `ftyp`, its
 * `moov` comes before the first `mdat`, and it is not fragmented (no `moof`). The server refuses
 * the first two as NOT_STREAMABLE; a fragmented file's `mvhd` carries no duration, so it would be
 * DECLARATION_MISMATCH — all three are remuxed rather than copied.
 */
export function isFastStart(boxes: readonly Mp4Box[]): boolean {
  if (boxes[0]?.type !== "ftyp") return false;
  const moov = boxes.findIndex((b) => b.type === "moov");
  const mdat = boxes.findIndex((b) => b.type === "mdat");
  const moof = boxes.findIndex((b) => b.type === "moof");
  return moov !== -1 && moof === -1 && (mdat === -1 || moov < mdat);
}

/** Whether `moov` declares fragments (`mvex`), which makes the file fragmented even before any `moof`. */
export async function isFragmentedMoov(source: BoxSource, moov: Mp4Box): Promise<boolean> {
  const children = await readBoxes(source, {
    start: moov.offset + moov.headerSize,
    end: moov.offset + moov.size,
    until: (b) => b.type === "mvex",
  });
  return children.some((b) => b.type === "mvex");
}

/** Whether the server's header read finds this `moov`: its header in the first 64 KiB, its end within 32 MiB. */
export function moovInServerReach(moov: Mp4Box | undefined): moov is Mp4Box {
  return !!moov && moov.offset + moov.headerSize <= SERVER_HEAD_BYTES && moov.offset + moov.size <= VIDEO_PROBE_BYTES;
}

/** Reads just enough boxes to answer {@link isFastStart}, looking inside `moov` for `mvex`. */
export async function scanFastStart(source: BoxSource): Promise<boolean> {
  const boxes = await readTopLevelBoxes(source, { until: (b) => b.type === "mdat" || b.type === "moof" });
  if (!isFastStart(boxes)) return false;
  const moov = boxes.find((b) => b.type === "moov");
  return !!moov && !(await isFragmentedMoov(source, moov));
}

/** The movie duration in `moov/mvhd` (what the server reads), in ms, or null when absent or unset. */
export async function readMvhdDurationMs(source: BoxSource, moov: Mp4Box): Promise<number | null> {
  const children = await readBoxes(source, {
    start: moov.offset + moov.headerSize,
    end: moov.offset + moov.size,
    until: (b) => b.type === "mvhd",
  });
  const mvhd = children.find((b) => b.type === "mvhd");
  if (!mvhd) return null;

  const body = await readRange(source, mvhd.offset + mvhd.headerSize, mvhd.offset + mvhd.headerSize + 32);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let timescale: number;
  let duration: number;
  if (body[0] === 1) {
    if (body.length < 32) return null;
    timescale = view.getUint32(20);
    duration = Number(view.getBigUint64(24));
  } else {
    if (body.length < 20) return null;
    timescale = view.getUint32(12);
    duration = view.getUint32(16);
    if (duration === 0xffffffff) return null;
  }
  return timescale > 0 ? Math.round((duration * 1000) / timescale) : null;
}
