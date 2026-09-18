/**
 * What the admin console is told about a row it is about to publish.
 *
 * What these guard: the preview page answers the console with a verdict, and the console shows that
 * verdict to the one person who can still stop a bad row. Every mistake it can make is quiet —
 * "rendered" over a row that draws nothing, or "refused" over one that would have been fine — and
 * neither is visible in a diff. The composition rule is the other half: an option kind has no
 * surface of its own, so a colour or a typeface is only ever seen through the kind that offers it,
 * and a preview that failed to find that kind would show an operator an empty box for every font
 * they ever upload.
 */

import { describe, expect, test, vi } from "vitest";
import { previewProfileFor } from "@/cosmetics/preview/previewProfile";
import type { PreviewItem } from "@/cosmetics/preview/protocol";

/**
 * A local storage, because this environment has none and the resolver reaches the renderers.
 *
 * Asking whether this build can draw a kind means asking the same list a surface mounts from, and
 * that list is components — which read the reduce-motion preference as they are imported. Hoisted
 * above the imports, which is the only place this can run.
 */
vi.hoisted(() => {
  const values = new Map<string, string>();

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => (values.has(key) ? values.get(key)! : null),
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => void values.delete(key),
      setItem: (key: string, value: string) => void values.set(key, String(value)),
    },
  });
});

const wearer = { bio: null, avatarFileId: null, primaryColor: null, accentColor: null };

function item(over: Partial<PreviewItem>): PreviewItem {
  return {
    kindKey: "profile.frame",
    slug: "preview",
    payloadJson: "{}",
    assets: [],
    ...over,
  };
}

const ringFrame = JSON.stringify({
  parts: [{ type: "ring", thickness: 6, colors: [4287679222], angle: 45, glow: 8, over: true, opacity: 1, inset: [0, 0, 0, 0] }],
});

describe("the verdict", () => {
  test("a known kind with a payload its own file accepts is drawn", () => {
    const answer = previewProfileFor(item({ payloadJson: ringFrame }), wearer);

    expect(answer.verdict).toBe("rendered");
    expect(answer.profile).not.toBeNull();
    expect(answer.stages).toEqual(["profileCard"]);
  });

  test("a payload the kind refuses is refused here, and nothing is dressed in it", () => {
    const answer = previewProfileFor(item({ payloadJson: JSON.stringify({ parts: "nope" }) }), wearer);

    expect(answer.verdict).toBe("payload-rejected");
    expect(answer.profile).toBeNull();
    expect(answer.stages).toEqual([]);
  });

  test("text that is not json is a refusal rather than a throw", () => {
    const answer = previewProfileFor(item({ payloadJson: "{parts:" }), wearer);

    expect(answer.verdict).toBe("payload-rejected");
  });

  test("a kind this build has no file for says so", () => {
    const answer = previewProfileFor(item({ kindKey: "profile.hologram", payloadJson: "{}" }), wearer);

    expect(answer.verdict).toBe("unknown-kind");
    expect(answer.worn).toBeNull();
  });
});

describe("an option, which nobody wears on its own", () => {
  test("a swatch is composed onto the kind that offers it, on that kind's own axis", () => {
    const answer = previewProfileFor(
      item({ kindKey: "option.swatch", slug: "hot-pink", payloadJson: JSON.stringify({ hex: "#ff5c8a" }) }),
      wearer,
    );

    expect(answer.verdict).toBe("rendered");
    expect(answer.worn?.key).toBe("nickname.style");

    const equipped = (answer.profile as unknown as { cosmetics: Record<string, unknown>[] }).cosmetics[0];

    expect(equipped.kindKey).toBe("nickname.style");
    expect(equipped.options).toEqual([
      expect.objectContaining({ facetId: "color", kindKey: "option.swatch", slug: "hot-pink" }),
    ]);
  });

  test("it is offered on the stages of the kind carrying it, not on none at all", () => {
    const answer = previewProfileFor(item({ kindKey: "option.font", payloadJson: JSON.stringify({ cssFamily: "Inter" }) }), wearer);

    expect(answer.stages).toEqual(["profileCard", "message", "memberRow"]);
  });
});

describe("what draws, but not as intended", () => {
  test("a kind that is its file, with an empty slot, is a warning rather than a refusal", () => {
    const answer = previewProfileFor(
      item({ kindKey: "avatar.decoration", payloadJson: JSON.stringify({ insetPct: 12, beneath: false }) }),
      wearer,
    );

    expect(answer.verdict).toBe("rendered");
    expect(answer.warnings.join(" ")).toContain("Primary");
  });

  test("a treatment whose slug this build ships no file for is named", () => {
    const answer = previewProfileFor(item({ kindKey: "option.text-effect", slug: "not-a-real-effect", payloadJson: "{}" }), wearer);

    expect(answer.verdict).toBe("rendered");
    expect(answer.warnings.join(" ")).toContain("not-a-real-effect");
  });

  test("a row whose files are in place says nothing", () => {
    const answer = previewProfileFor(
      item({
        kindKey: "avatar.decoration",
        payloadJson: JSON.stringify({ insetPct: 12, beneath: false }),
        assets: [{ slot: "Primary", fileId: "abc" }],
      }),
      wearer,
    );

    expect(answer.warnings).toEqual([]);
  });
});
