import { expect, test } from "vitest";
import { StrokeCanvas } from "@/lib/screencast-draw/StrokeCanvas";
import { samplePoint, type NormPoint, type StrokeTool } from "@/lib/screencast-draw/types";

async function paint(tool: StrokeTool, points: NormPoint[]) {
  const canvas = document.createElement("canvas");
  const surface = new StrokeCanvas(canvas);
  surface.resize(200, 80);
  surface.ingest({
    v: 1, from: "viewer", target: "host", t: 0, kind: "begin", strokeId: "s",
    tool, color: "#ff0000", width: 0.1, ttlMs: 6000, p: points,
  });
  surface.kick();
  await new Promise(requestAnimationFrame);
  surface.dispose();
  return canvas.getContext("2d")!;
}

test("the brush sends pen and Force Touch pressure; ordinary mouse and arrow points keep two coordinates", () => {
  const sample = (tool: StrokeTool, pointerType: string, pressure: number) =>
    samplePoint(tool, 0.2, 0.3, new PointerEvent("pointermove", { pointerType, buttons: 1, pressure }));
  expect(sample("brush", "pen", 0.125)).toEqual([0.2, 0.3, 0.125]);
  expect(sample("brush", "mouse", 0.75)).toEqual([0.2, 0.3, 0.75]);
  expect(sample("brush", "mouse", 0)).toEqual([0.2, 0.3, 0]);
  expect(sample("brush", "mouse", 0.5)).toEqual([0.2, 0.3]);
  expect(sample("arrow", "pen", 0.75)).toEqual([0.2, 0.3]);
});

test("brush width follows pressure along the stroke and a stationary press grows a dot", async () => {
  const ctx = await paint("brush", [[0.15, 0.5, 0], [0.5, 0.5], [0.8, 0.5, 1]]);
  const red = (context: CanvasRenderingContext2D, x: number, y: number) => {
    const [r, , , a] = context.getImageData(x, y, 1, 1).data;
    return r > 200 && a > 200;
  };
  expect(red(ctx, 30, 40)).toBe(true);
  expect(red(ctx, 30, 48)).toBe(false);
  expect(red(ctx, 100, 48)).toBe(true);
  expect(red(ctx, 100, 54)).toBe(false);
  expect(red(ctx, 160, 54)).toBe(true);

  const dot = await paint("brush", [[0.5, 0.5, 0.1], [0.5, 0.5, 1]]);
  expect(red(dot, 100, 54)).toBe(true);
});
