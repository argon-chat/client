import {
  describe,
  expect,
  test,
} from "vitest";

import { leadingGraphemes } from "@/cosmetics/preview/leadingGraphemes";

describe("leadingGraphemes", () => {
  test("keeps a short name whole and cuts a long one", () => {
    expect(leadingGraphemes("Omni", 6)).toBe("Omni");
    expect(leadingGraphemes("Omnifaced", 6)).toBe("Omnifa");
  });

  test("never splits a surrogate pair or a joined emoji", () => {
    expect(leadingGraphemes("ab😀cd", 3)).toBe("ab😀");
    expect(leadingGraphemes("👨‍👩‍👧x", 1)).toBe("👨‍👩‍👧");
  });

  test("an empty name or a zero count is empty", () => {
    expect(leadingGraphemes("", 6)).toBe("");
    expect(leadingGraphemes("Omni", 0)).toBe("");
  });
});
