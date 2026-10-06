import { describe, expect, it } from "vitest";
import { isFastStart, readTopLevelBoxes, scanFastStart } from "@/lib/video/mp4Boxes";

function box(type: string, payload: Uint8Array = new Uint8Array(0), children: Uint8Array[] = []): Uint8Array {
  const body = concat([payload, ...children]);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(body, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const ftyp = () => box("ftyp", new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]));
const mvhd = () => box("mvhd", new Uint8Array(100));
const mdat = () => box("mdat", new Uint8Array(32));

describe("mp4Boxes", () => {
  it("reads top-level boxes and stops at the first mdat", async () => {
    const file = concat([ftyp(), box("moov", undefined, [mvhd()]), mdat()]);
    const boxes = await readTopLevelBoxes(file, { until: (b) => b.type === "mdat" });
    expect(boxes.map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
    expect(isFastStart(boxes)).toBe(true);
    await expect(scanFastStart(file)).resolves.toBe(true);
  });

  it("is not fast start when moov follows mdat", async () => {
    const file = concat([ftyp(), mdat(), box("moov", undefined, [mvhd()])]);
    await expect(scanFastStart(file)).resolves.toBe(false);
  });

  it("treats a fragmented file (mvex in moov) as not streamable as-is", async () => {
    const moov = box("moov", undefined, [mvhd(), box("mvex", undefined, [box("trex", new Uint8Array(24))])]);
    const file = concat([ftyp(), moov, box("moof", new Uint8Array(16)), mdat()]);
    await expect(scanFastStart(file)).resolves.toBe(false);
  });

  it("treats a moof before the first mdat as fragmented even without mvex", async () => {
    const file = concat([ftyp(), box("moov", undefined, [mvhd()]), box("moof", new Uint8Array(16)), mdat()]);
    await expect(scanFastStart(file)).resolves.toBe(false);
  });

  it("rejects a file that does not open with ftyp", async () => {
    const file = concat([box("moov", undefined, [mvhd()]), mdat()]);
    await expect(scanFastStart(file)).resolves.toBe(false);
  });
});
