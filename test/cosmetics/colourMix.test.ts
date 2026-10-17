import {
  describe,
  expect,
  it,
} from "vitest";

import {
  lightenColour,
  shadeColour,
} from "@/cosmetics/primitives/colourMix";

describe("colour mixing", () => {
  it("reads hex and rgb() and gives hex back", () => {
    expect(lightenColour("#000000", 0.5)).toBe("#808080");
    expect(shadeColour("rgb(200, 100, 50)", 0.5)).toBe("#643219");
  });

  it("keeps the alpha of an rgba() colour exactly as written", () => {
    expect(shadeColour("rgba(200, 100, 50, 0.50)", 0.5)).toBe("rgba(100, 50, 25, 0.50)");
    expect(lightenColour("rgba(0, 0, 0, 0.25)", 0.5)).toBe("rgba(128, 128, 128, 0.25)");
  });

  it("keeps an alpha written the modern way", () => {
    expect(shadeColour("rgb(200 100 50 / 40%)", 0.5)).toBe("rgba(100, 50, 25, 40%)");
  });

  it("gives back anything it cannot read", () => {
    expect(lightenColour("var(--role)", 0.5)).toBe("var(--role)");
    expect(shadeColour("rgba(1, 2, 3, 0.5) trailing", 0.5)).toBe("rgba(1, 2, 3, 0.5) trailing");
  });
});
