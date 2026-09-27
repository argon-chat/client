/**
 * Crop → export, the maths: the crop rect the editor shows lands exactly on the output whatever the
 * image's, the crop's and the crop area's aspect ratios, the zoom, the pan and the quarter turns.
 * The app's GPU test (test/browser/workbench/cropExport.test.ts) checks the same on real pixels.
 *
 * The editor's model (CropHandles, computeCropBounds): at scale 1 the image is contained in the
 * crop area, the crop rect is `currentImageRatio` contained in it and centred, and the translation
 * is in those pixels.
 */

import { describe, test, expect } from "vitest";
import getResultTransform from "../src/finalRender/getResultTransform";
import getScaledLayersAndLines from "../src/finalRender/getScaledLayersAndLines";
import { computeExportDimensions } from "../src/finalRender/computeExportDimensions";
import { quarterTurnLeft } from "../src/canvas/quarterTurn";
import { computeCropBounds } from "../src/canvas/computeCropBounds";
import { sourceToCanvas } from "../src/mask/maskMath";
import { fitToAspectRatio, rotatePoint } from "../src/geometry";
import type { EditorLayer, Vec2 } from "../src/types";

type Rect = { x: number; y: number; w: number; h: number };
type Area = { left: number; top: number; width: number; height: number };

const area = (width: number, height: number): Area => ({ left: 60, top: 60, width, height });

/** The state a crop to `rect` (source pixels), turned by `quarterTurns`, leaves in the editor. */
function cropState(co: Area, media: Vec2, rect: Rect, quarterTurns = 0) {
  const [fitW] = fitToAspectRatio(media[0] / media[1], co.width, co.height);
  const perSource = fitW / media[0];
  const odd = Math.abs(quarterTurns) % 2 === 1;
  const [shownW, shownH] = odd ? [rect.h, rect.w] : [rect.w, rect.h];
  const currentImageRatio = shownW / shownH;
  const [cropW] = fitToAspectRatio(currentImageRatio, co.width, co.height);
  const scale = cropW / (shownW * perSource);
  const rotation = (quarterTurns * Math.PI) / 2;
  const k = scale * perSource;
  const [tx, ty] = rotatePoint([(rect.x + rect.w / 2 - media[0] / 2) * k, (rect.y + rect.h / 2 - media[1] / 2) * k], rotation);
  return { currentImageRatio, scale, rotation, translation: [-tx, -ty] as Vec2, flip: [1, 1] as Vec2 };
}

function exportSize(co: Area, media: Vec2, state: ReturnType<typeof cropState>): Vec2 {
  return computeExportDimensions({
    sourceWidth: media[0],
    sourceAspectRatio: media[0] / media[1],
    cropAspectRatio: state.currentImageRatio,
    cropAreaSize: co,
    zoomScale: state.scale,
  });
}

/** Where the four corners of `rect` land on a `size` output. */
function mappedCorners(co: Area, media: Vec2, rect: Rect, state: ReturnType<typeof cropState>, size: Vec2): Vec2[] {
  const t = getResultTransform({ scaledWidth: size[0], scaledHeight: size[1], imageWidth: media[0], imageHeight: media[1], cropOffset: co, mediaState: state });
  const corners: Vec2[] = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]];
  return corners.map((p) => sourceToCanvas(p, t, size, media));
}

function expectOnCorners(points: Vec2[], size: Vec2) {
  const want: Vec2[] = [[0, 0], [size[0], 0], [0, size[1]], [size[0], size[1]]];
  const hit = new Set<number>();
  for (const p of points) {
    const i = want.findIndex((c) => Math.abs(c[0] - p[0]) < 1e-6 && Math.abs(c[1] - p[1]) < 1e-6);
    expect(i, `${p} is not an output corner of ${size}`).toBeGreaterThanOrEqual(0);
    hit.add(i);
  }
  expect(hit.size).toBe(4);
}

const AREAS = [area(760, 536), area(380, 720), area(600, 600)];
const CASES: [string, Vec2, Rect][] = [
  ["4:3, top-left quadrant", [800, 600], { x: 0, y: 0, w: 400, h: 300 }],
  ["4:3, a tall strip", [800, 600], { x: 300, y: 100, w: 240, h: 400 }],
  ["8:3 panorama, centre square", [1600, 600], { x: 500, y: 0, w: 600, h: 600 }],
  ["1:2 portrait, bottom band", [600, 1200], { x: 20, y: 900, w: 560, h: 280 }],
];

describe("the crop rect onto the output", () => {
  for (const co of AREAS) {
    for (const [name, media, rect] of CASES) {
      for (const turns of [0, 1, -1, 2]) {
        test(`${name}, crop area ${co.width}×${co.height}, ${turns} quarter turns`, () => {
          const state = cropState(co, media, rect, turns);
          const size = exportSize(co, media, state);
          // Exported at the source's own resolution, sides swapped by a quarter turn.
          expect(size).toEqual(Math.abs(turns) % 2 ? [rect.h, rect.w] : [rect.w, rect.h]);
          expectOnCorners(mappedCorners(co, media, rect, state, size), size);
        });
      }
    }
  }

  test("any output size: the crop covers it, centred, never leaving an empty edge", () => {
    const co = AREAS[0];
    const media: Vec2 = [800, 600];
    const rect = { x: 0, y: 0, w: 400, h: 300 };
    const state = cropState(co, media, rect);
    const size: Vec2 = [512, 383];
    const [a, , , d] = mappedCorners(co, media, rect, state, size);
    // 512 / 400 > 383 / 300: exact across, 384 px tall, so half a pixel over at the top and bottom.
    expect(a[0]).toBeCloseTo(0, 6);
    expect(d[0]).toBeCloseTo(512, 6);
    expect(a[1]).toBeCloseTo(-0.5, 6);
    expect(d[1]).toBeCloseTo(383.5, 6);
  });

  test("an unset crop ratio is the image's", () => {
    const co = AREAS[1];
    const t = getResultTransform({
      scaledWidth: 512,
      scaledHeight: 384,
      imageWidth: 800,
      imageHeight: 600,
      cropOffset: co,
      mediaState: { scale: 1, rotation: 0, translation: [0, 0], flip: [1, 1], currentImageRatio: 0 },
    });
    expect(t.scale).toBeCloseTo(0.64, 10);
  });

  test("float noise in the crop ratio does not cost two pixels", () => {
    // What a crop dragged to exactly half computes: 399.9998 px of source across.
    const size = computeExportDimensions({
      sourceWidth: 800,
      sourceAspectRatio: 4 / 3,
      cropAspectRatio: 1.333332711442786,
      cropAreaSize: { width: 760, height: 536 },
      zoomScale: 2,
    });
    expect(size).toEqual([400, 300]);
  });
});

describe("rotate left keeps the crop", () => {
  for (const co of AREAS) {
    test(`a free crop swaps its sides and shows the same pixels, turned (crop area ${co.width}×${co.height})`, () => {
      const media: Vec2 = [800, 600];
      const rect = { x: 40, y: 60, w: 300, h: 180 };
      const before = cropState(co, media, rect);
      const turn = quarterTurnLeft({ ...before, cropArea: co, fixedRatio: false });
      const after = cropState(co, media, rect, -1);
      expect(turn.ratio).toBeCloseTo(after.currentImageRatio, 10);
      expect(turn.scale).toBeCloseTo(after.scale, 10);
      expect(turn.translation[0]).toBeCloseTo(after.translation[0], 8);
      expect(turn.translation[1]).toBeCloseTo(after.translation[1], 8);
    });

    test(`a fixed ratio stays, and the image still covers the crop (crop area ${co.width}×${co.height})`, () => {
      const media: Vec2 = [800, 600];
      const before = cropState(co, media, { x: 380, y: 250, w: 400, h: 300 });
      const turn = quarterTurnLeft({ ...before, cropArea: co, fixedRatio: true });
      expect(turn.ratio).toBeCloseTo(4 / 3, 10);
      const b = computeCropBounds({
        scale: turn.scale,
        rotation: before.rotation - Math.PI / 2,
        translation: turn.translation,
        mediaSize: media,
        currentImageRatio: turn.ratio,
        cropOffset: co,
      });
      expect(b.imageMinX).toBeLessThanOrEqual(b.cropMinX + 1e-6);
      expect(b.imageMaxX).toBeGreaterThanOrEqual(b.cropMaxX - 1e-6);
      expect(b.imageMinY).toBeLessThanOrEqual(b.cropMinY + 1e-6);
      expect(b.imageMaxY).toBeGreaterThanOrEqual(b.cropMaxY - 1e-6);
    });
  }
});

describe("layers and brush lines follow the crop rect on screen", () => {
  const layer = (position: Vec2): EditorLayer => ({ id: 1, type: "text", position, rotation: 0, scale: 1 }) as EditorLayer;

  test("the displayed crop rect's corners are the output's corners; scale follows", () => {
    // Canvas 1000×800, square crop → shown as 800×800 at x = 100.
    const { scaledLayers } = getScaledLayersAndLines({
      layers: [layer([100, 0]), layer([900, 800]), layer([500, 400])],
      lines: [],
      canvasSize: [1000, 800],
      resultSize: [600, 600],
      cropRatio: 1,
    });
    expect(scaledLayers.map((l) => l.position)).toEqual([[0, 0], [600, 600], [300, 300]]);
    expect(scaledLayers[0].scale).toBeCloseTo(0.75, 10);
  });

  test("brush lines are in device pixels", () => {
    const { scaledLines } = getScaledLayersAndLines({
      layers: [],
      lines: [{ color: "#fff", brush: "pen", size: 20, points: [[200, 0], [1800, 1600]] }],
      canvasSize: [1000, 800],
      resultSize: [600, 600],
      cropRatio: 1,
      pixelRatio: 2,
    });
    expect(scaledLines[0].points).toEqual([[0, 0], [600, 600]]);
    expect(scaledLines[0].size).toBeCloseTo(7.5, 10);
  });
});
