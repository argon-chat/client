import { describe, expect, test } from "vitest";
import { cropSpotlightPath } from "../../../packages/media-editor/src/canvas/cropSpotlight";

function alphaAt(path: string, x: number, y: number): number {
  const canvas = new OffscreenCanvas(100,100);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgba(0,0,0,0.5)";
  context.fill(new Path2D(path), "evenodd");
  return context.getImageData(x,y,1,1).data[3]!;
}
describe("crop spotlight rendered geometry", () => {
  test("the rectangular crop stays clear while its surroundings are shaded", () => {
    const path = cropSpotlightPath(100,100,20,30,60,40,0);
    expect(alphaAt(path,50,50)).toBe(0);
    expect(alphaAt(path,10,50)).toBe(128);
    expect(alphaAt(path,50,10)).toBe(128);
    expect(alphaAt(path,90,50)).toBe(128);
    expect(alphaAt(path,50,90)).toBe(128);
  });
  test("avatar crops keep circular corners shaded without dimming their centre", () => {
    const path = cropSpotlightPath(100,100,20,20,60,60,30);
    expect(alphaAt(path,50,50)).toBe(0);
    expect(alphaAt(path,21,21)).toBe(128);
    expect(alphaAt(path,79,79)).toBe(128);
    expect(alphaAt(path,50,21)).toBe(0);
  });
});
