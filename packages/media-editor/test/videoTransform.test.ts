/**
 * The editor's crop, quarter turns and mirror as a converter takes them (turn, then mirror, then cut,
 * in display pixels of the source): the rect the editor shows is the rect that is cut, whatever the
 * crop area, zoom, pan, turns and mirrors. The model is the one crop.test.ts checks the export with.
 */
import { describe, test, expect } from "vitest";
import { sourceVideoTransform, hasPixelEdits } from "../src/finalRender/videoTransform";
import { fitToAspectRatio, rotatePoint } from "../src/geometry";
import type { Vec2 } from "../src/types";

type Rect = { x: number; y: number; w: number; h: number };
type Area = { width: number; height: number };

/** The state a crop to `rect` (source pixels), turned by `quarterTurns` and mirrored by `flip`, leaves in the editor. */
function cropState(co: Area, media: Vec2, rect: Rect, quarterTurns = 0, flip: Vec2 = [1, 1]) {
  const [fitW] = fitToAspectRatio(media[0] / media[1], co.width, co.height);
  const perSource = fitW / media[0];
  const odd = Math.abs(quarterTurns) % 2 === 1;
  const [shownW, shownH] = odd ? [rect.h, rect.w] : [rect.w, rect.h];
  const currentImageRatio = shownW / shownH;
  const [cropW] = fitToAspectRatio(currentImageRatio, co.width, co.height);
  const scale = cropW / (shownW * perSource);
  const rotation = (quarterTurns * Math.PI) / 2;
  const k = scale * perSource;
  // The rect's centre, mirrored then turned, lands on the crop's centre.
  const centre: Vec2 = [(rect.x + rect.w / 2 - media[0] / 2) * k * flip[0], (rect.y + rect.h / 2 - media[1] / 2) * k * flip[1]];
  const [tx, ty] = rotatePoint(centre, rotation);
  return { currentImageRatio, scale, rotation, translation: [-tx, -ty] as Vec2, flip, perspective: [0, 0] as Vec2 };
}

type M2 = [number, number, number, number];
const mul = (a: M2, b: M2): M2 =>
  [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]].map((v) => v + 0) as M2;
/** Clockwise on a y-down screen, as the shader and rotatePoint turn. */
const rot = (deg: number): M2 => {
  const r = (deg * Math.PI) / 180;
  return [Math.round(Math.cos(r)), -Math.round(Math.sin(r)), Math.round(Math.sin(r)), Math.round(Math.cos(r))];
};
const diag = (x: number, y: number): M2 => [x, 0, 0, y];

/** Where `rect` lands in the frame turned by `rotate` and then mirrored. */
function expectedCrop(media: Vec2, rect: Rect, rotate: number, flip: boolean) {
  const m = mul(diag(flip ? -1 : 1, 1), rot(rotate));
  const [fw, fh] = rotate % 180 === 0 ? media : [media[1], media[0]];
  const corners: Vec2[] = [[rect.x, rect.y], [rect.x + rect.w, rect.y + rect.h]];
  const mapped = corners.map(([x, y]) => {
    const dx = x - media[0] / 2;
    const dy = y - media[1] / 2;
    return [m[0] * dx + m[1] * dy + fw / 2, m[2] * dx + m[3] * dy + fh / 2];
  });
  const xs = mapped.map((p) => p[0]);
  const ys = mapped.map((p) => p[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

const AREAS: Area[] = [{ width: 760, height: 536 }, { width: 380, height: 720 }, { width: 600, height: 600 }];
const CASES: [string, Vec2, Rect][] = [
  ["16:9, a centred square", [1920, 1080], { x: 420, y: 0, w: 1080, h: 1080 }],
  ["16:9, the top-left quarter", [1920, 1080], { x: 0, y: 0, w: 960, h: 540 }],
  ["9:16 portrait, a band low down", [1080, 1920], { x: 40, y: 1200, w: 1000, h: 600 }],
];
const FLIPS: [string, Vec2][] = [["no mirror", [1, 1]], ["mirrored across", [-1, 1]], ["mirrored up-down", [1, -1]], ["both", [-1, -1]]];

describe("sourceVideoTransform", () => {
  for (const co of AREAS) {
    for (const [name, media, rect] of CASES) {
      for (const turns of [0, 1, -1, 2]) {
        for (const [flipName, flip] of FLIPS) {
          test(`${name}, area ${co.width}×${co.height}, ${turns} quarter turns, ${flipName}`, () => {
            const state = cropState(co, media, rect, turns, flip);
            const t = sourceVideoTransform(state, media, co)!;
            expect(t).not.toBeNull();

            // Turn-then-mirror is the editor's mirror-then-turn.
            expect(mul(diag(t.flip ? -1 : 1, 1), rot(t.rotate))).toEqual(mul(rot(turns * 90), diag(flip[0], flip[1])));

            const want = expectedCrop(media, rect, t.rotate, t.flip);
            expect(t.crop).toEqual({
              left: Math.round(want.left),
              top: Math.round(want.top),
              width: Math.round(want.width),
              height: Math.round(want.height),
            });
            expect([t.width, t.height]).toEqual(Math.abs(turns) % 2 ? [rect.h, rect.w] : [rect.w, rect.h]);
          });
        }
      }
    }
  }

  test("a centred square of a 16:9 frame turned clockwise is cut from the turned frame's middle band", () => {
    const co = AREAS[0];
    const t = sourceVideoTransform(cropState(co, [1920, 1080], { x: 420, y: 0, w: 1080, h: 1080 }, 1), [1920, 1080], co)!;
    expect(t).toEqual({ rotate: 90, flip: false, crop: { left: 0, top: 420, width: 1080, height: 1080 }, width: 1080, height: 1080 });
  });

  test("the whole frame is no crop", () => {
    const co = AREAS[1];
    const t = sourceVideoTransform({ scale: 1, rotation: 0, translation: [0, 0], flip: [1, 1], perspective: [0, 0], currentImageRatio: 0 }, [1280, 720], co);
    expect(t).toEqual({ rotate: 0, flip: false, crop: null, width: 1280, height: 720 });
  });

  test("a turn by a free angle, or a perspective tilt, cannot be converted", () => {
    const co = AREAS[0];
    const base = cropState(co, [1920, 1080], { x: 0, y: 0, w: 960, h: 540 });
    expect(sourceVideoTransform({ ...base, rotation: 0.1 }, [1920, 1080], co)).toBeNull();
    expect(sourceVideoTransform({ ...base, perspective: [0.05, 0] }, [1920, 1080], co)).toBeNull();
  });
});

describe("hasPixelEdits", () => {
  const base = {
    adjustments: { enhance: 0, brightness: 0 },
    curves: { r: [0, 0], g: [0, 0], b: [0, 0] },
    selective: { hue: 0, range: 0, shift: 0, sat: 0, luma: 0 },
    perspective: [0, 0],
    resizableLayers: [],
    brushDrawnLines: [],
    mask: { source: null, feather: 0, strokes: [] },
    outline: { enabled: false, radius: 8, color: "#fff" },
  };
  const edits = (patch: object) => hasPixelEdits({ ...base, ...patch } as never);

  test.each([
    ["nothing", {}, false],
    ["a brush stroke", { brushDrawnLines: [{}] }, true],
    ["a text layer", { resizableLayers: [{ type: "text" }] }, true],
    ["an adjustment (a preset sets these)", { adjustments: { enhance: 0, brightness: 0.2 } }, true],
    ["a curve", { curves: { r: [0.1, 0], g: [0, 0], b: [0, 0] } }, true],
    ["selective colour", { selective: { hue: 0.3, range: 0, shift: 0, sat: 0, luma: 0 } }, true],
    ["a perspective tilt", { perspective: [0, 0.2] }, true],
  ] as const)("%s → %s", (_, patch, expected) => {
    expect(edits(patch)).toBe(expected);
  });
});
