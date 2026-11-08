/** Pixel-level brush behavior, using Chromium's real Canvas2D rasterizer. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createBrushPainter, type BrushDrawnLine, type BrushPainterAPI } from "../../src/canvas/brushPainter";

const painters: BrushPainterAPI[] = [];
afterEach(() => { for (const p of painters.splice(0)) p.dispose(); vi.unstubAllGlobals(); });
function canvas() { const c = document.createElement("canvas"); c.width = 96; c.height = 80; return c; }
function rgba(c: HTMLCanvasElement, x: number, y: number) { return [...c.getContext("2d")!.getImageData(x, y, 1, 1).data]; }
function line(brush: string, points: [number, number][], size = 10): BrushDrawnLine { return { brush, points, size, color: "#ff0000" }; }
function fill(c: HTMLCanvasElement, color: string) { const ctx = c.getContext("2d")!; ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height); }
function fixture() {
  const source = canvas(), target = canvas();
  const painter = createBrushPainter({ targetCanvas: target, imageCanvas: source, blurRadius: 4 });
  painters.push(painter); return { source, target, painter };
}

describe("brush rasterization", () => {
  test("the very first blur stroke has a visible, blurred source inside its mask", () => {
    const { source, target, painter } = fixture();
    const ctx = source.getContext("2d")!;
    ctx.fillStyle = "red"; ctx.fillRect(0, 0, 48, 80);
    ctx.fillStyle = "blue"; ctx.fillRect(48, 0, 48, 80);
    // No earlier commit initializes the blur cache.
    painter.preview(line("blur", [[48, 40]], 24));
    const [r, g, b, a] = rgba(target, 48, 40);
    expect(a).toBeGreaterThan(250); expect(r).toBeGreaterThan(60); expect(b).toBeGreaterThan(60); expect(g).toBe(0);
    expect(rgba(target, 20, 40)[3]).toBe(0);
  });

  test("blur copies stay inside both canvases and outside pixels remain untouched", () => {
    const { source, target, painter } = fixture(); fill(source, "#40c080");
    const copies = vi.spyOn(target.getContext("2d")!, "drawImage");
    painter.preview(line("blur", [[92.25, 75.25]], 13));
    const regions = copies.mock.calls.filter(args => args.length === 9);
    expect(regions.length).toBeGreaterThan(0);
    for (const [input, sx, sy, sw, sh, dx, dy, dw, dh] of regions as unknown as [HTMLCanvasElement, number, number, number, number, number, number, number, number][]) {
      expect(sx).toBeGreaterThanOrEqual(0); expect(sy).toBeGreaterThanOrEqual(0);
      expect(sx + sw).toBeLessThanOrEqual(input.width); expect(sy + sh).toBeLessThanOrEqual(input.height);
      expect(dx + dw).toBeLessThanOrEqual(target.width); expect(dy + dh).toBeLessThanOrEqual(target.height);
    }
    expect(rgba(target, 92, 75)[3]).toBeGreaterThan(100);
    expect(rgba(target, 78, 75)[3]).toBe(0); expect(rgba(target, 92, 60)[3]).toBe(0);
    // Replacing a preview must not retain its old stencil.
    painter.preview(line("blur", [[24, 24]], 12));
    expect(rgba(target, 92, 75)[3]).toBe(0); expect(rgba(target, 24, 24)).toEqual([64, 192, 128, 255]);
    expect(rgba(target, 31, 24)[3]).toBe(0);
  });

  test.each(["dot", "stroke"])("an eraser %s removes antialiased coverage exactly once", kind => {
    const { target, painter } = fixture();
    painter.commitLine(line("pen", [[0, 40], [96, 40]], 100));
    const points: [number, number][] = kind === "dot" ? [[40.25, 40.25]] : [[28.25, 40.25], [60.25, 40.25]];
    painter.commitLine(line("eraser", points, 9));
    const reference = canvas(); fill(reference, "red");
    const ctx = reference.getContext("2d")!;
    ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "white"; ctx.strokeStyle = "white";
    if (kind === "dot") { ctx.beginPath(); ctx.arc(40.25, 40.25, 4.5, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.lineWidth = 9; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(28.25, 40.25); ctx.lineTo(60.25, 40.25); ctx.stroke(); }
    const actual = target.getContext("2d")!.getImageData(20, 31, 50, 19).data;
    const expected = ctx.getImageData(20, 31, 50, 19).data;
    let partial = 0;
    for (let i = 3; i < actual.length; i += 4) {
      if (expected[i] > 0 && expected[i] < 255) partial++;
      expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(1);
    }
    expect(partial).toBeGreaterThan(0);
  });

  test("neon has a white core and a colored halo beyond the stroke", () => {
    const { target, painter } = fixture(); painter.commitLine(line("neon", [[20, 40], [76, 40]], 8));
    expect(rgba(target, 48, 40)).toEqual([255, 255, 255, 255]);
    const [r, g, b, a] = rgba(target, 48, 47);
    expect(a).toBeGreaterThan(0); expect(r).toBeGreaterThan(240); expect(g).toBeLessThan(10); expect(b).toBeLessThan(10);
    expect(rgba(target, 48, 65)[3]).toBe(0);
  });

  test("ordinary painting and history replay never read the image source", () => {
    const source = vi.fn(() => { throw new Error("unexpected GPU source readback"); });
    const painter = createBrushPainter({ targetCanvas: canvas(), imageCanvas: source }); painters.push(painter);
    const lines = [line("pen", [[10, 20], [70, 20]]), line("neon", [[10, 40], [70, 40]]), line("eraser", [[35, 20]], 8)];
    for (const stroke of lines) painter.commitLine(stroke);
    painter.redrawAll(lines); painter.discard(); painter.clear(); expect(source).not.toHaveBeenCalled();
  });

  test("blur source stays cached during preview and refreshes after source invalidation", () => {
    const source = canvas(), target = canvas(); fill(source, "red");
    const read = vi.fn(() => source);
    const painter = createBrushPainter({ targetCanvas: target, imageCanvas: read, blurRadius: 4 }); painters.push(painter);
    painter.preview(line("blur", [[40, 40]], 12)); expect(rgba(target, 40, 40)).toEqual([255, 0, 0, 255]);
    painter.preview(line("blur", [[42, 40]], 12)); expect(read).toHaveBeenCalledTimes(1);
    fill(source, "blue"); painter.invalidateSource();
    painter.preview(line("blur", [[42, 40]], 12)); expect(read).toHaveBeenCalledTimes(2);
    expect(rgba(target, 42, 40)).toEqual([0, 0, 255, 255]);
  });

  test("disposing settles and cancels an arrow animation without a later repaint", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const { target, painter } = fixture();
    const animation = painter.animateArrow(line("arrow", [[20, 40], [65, 40]], 8)); expect(frames).toHaveLength(1);
    painter.dispose(); await animation;
    const before = [...target.getContext("2d")!.getImageData(0, 0, target.width, target.height).data];
    frames.shift()!(performance.now() + 1000); expect(frames).toHaveLength(0);
    expect([...target.getContext("2d")!.getImageData(0, 0, target.width, target.height).data]).toEqual(before);
    await painter.animateArrow(line("arrow", [[20, 40], [65, 40]], 8)); expect(frames).toHaveLength(0);
  });
});
