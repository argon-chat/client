import { describe, expect, it } from "vitest";
import { extractInviteCode } from "@/lib/inviteCode";

/**
 * What people paste into the join box is whatever they were sent, and the server only understands
 * the nine characters at the end of it.
 */
describe("extractInviteCode", () => {
  it("leaves a bare code alone", () => {
    expect(extractInviteCode("ABC-DEF-GHI")).toBe("ABC-DEF-GHI");
    expect(extractInviteCode("  ABC-DEF-GHI  ")).toBe("ABC-DEF-GHI");
  });

  it("takes the code out of a web invite link", () => {
    expect(extractInviteCode("https://argon.gl/i/ABC-DEF-GHI")).toBe("ABC-DEF-GHI");
    expect(extractInviteCode("https://argon.gl/v/ABC-DEF-GHI")).toBe("ABC-DEF-GHI");
    // A self-hosted instance hands out its own domain; the shape of the path is what matters.
    expect(extractInviteCode("https://chat.example.com/i/ABC-DEF-GHI")).toBe("ABC-DEF-GHI");
  });

  it("takes the code out of a deep link", () => {
    expect(extractInviteCode("argon://invite/ABC-DEF-GHI")).toBe("ABC-DEF-GHI");
    expect(extractInviteCode("argon://v/ABC-DEF-GHI")).toBe("ABC-DEF-GHI");
  });

  it("ignores what chat clients add to a pasted link", () => {
    expect(extractInviteCode("https://argon.gl/i/ABC-DEF-GHI/")).toBe("ABC-DEF-GHI");
    expect(extractInviteCode("https://argon.gl/i/ABC-DEF-GHI?utm_source=telegram")).toBe("ABC-DEF-GHI");
    expect(extractInviteCode("https://argon.gl/i/ABC-DEF-GHI#top")).toBe("ABC-DEF-GHI");
  });

  it("passes anything it cannot read through, so the server gives the verdict", () => {
    expect(extractInviteCode("not a link")).toBe("not a link");
    expect(extractInviteCode("")).toBe("");
  });
});
