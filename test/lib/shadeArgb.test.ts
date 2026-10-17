import {
  describe,
  expect,
  it,
} from "vitest";

import {
  argbToRgb,
  hexToArgb,
  shadeArgb,
} from "@/lib/profileCustomization";

describe("shadeArgb", () => {
  it("mixes towards black and keeps the alpha", () => {
    const shaded = shadeArgb(hexToArgb("#c86432"), 0.5);

    expect(argbToRgb(shaded)).toBe("rgb(100, 50, 25)");
    expect((shaded >>> 24) & 0xff).toBe(0xff);
  });

  it("stays a signed i32, so it can go back over the wire as an i4", () => {
    const shaded = shadeArgb(hexToArgb("#ffffff"), 0);

    expect(shaded).toBe(hexToArgb("#ffffff"));
    expect(shaded).toBeLessThan(0);
  });

  it("is black at full strength", () => {
    expect(argbToRgb(shadeArgb(hexToArgb("#123456"), 1))).toBe("rgb(0, 0, 0)");
  });
});
