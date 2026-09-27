/**
 * What an upload is checked against before it is sent: its type by magic bytes, the size cap of that
 * type for emoji and stickers, the canvas rules, Lottie's frame rate, length and forbidden features,
 * and the name, emoji and keyword rules — the server's ExpressionLimits, mirrored.
 */

import { describe, test, expect } from "vitest";
import { ExpressionFormat, ExpressionKind } from "@argon/glue";
import {
  associatedEmojiError,
  checkDimensions,
  checkDuration,
  checkSize,
  extractEmoji,
  formatOf,
  inspectExpressionFile,
  inspectLottieJson,
  isRejection,
  itemNameError,
  keywordsError,
  packSlugError,
  packTitleError,
  pngHeader,
  slugify,
  sniffType,
  suggestItemName,
  webpHeader,
} from "@/lib/expressions/uploadPrep";
import { quotaFor, packItemLimit } from "@/lib/expressions/limits";

const { Emoji, Sticker } = ExpressionKind;
const KB = 1024;

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

function png(width: number, height: number, { animated = false } = {}): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: number[]) => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
    ...(animated ? chunk("acTL", [...be32(2), ...be32(0)]) : []),
    ...chunk("IDAT", [0]),
    ...chunk("IEND", []),
  ]);
}

function webpVp8x(width: number, height: number, animated: boolean): Uint8Array {
  const flags = animated ? 0x02 : 0;
  return new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8X"), 10, 0, 0, 0, flags, 0, 0, 0, ...le24(width - 1), ...le24(height - 1), 0, 0]);
}

function webpVp8l(width: number, height: number): Uint8Array {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8L"), 5, 0, 0, 0, 0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255, 0, 0, 0, 0, 0]);
}

function webpVp8(width: number, height: number): Uint8Array {
  return new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 "), 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, width & 255, width >> 8, height & 255, height >> 8, 0, 0]);
}

async function gzipped(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(...value);
  }
  return new Uint8Array(chunks);
}

const lottie = (extra: Record<string, unknown> = {}) => ({ v: "5.7.4", fr: 30, ip: 0, op: 60, w: 512, h: 512, layers: [{ ty: 4, shapes: [] }], ...extra });

describe("sniffType", () => {
  test("by magic bytes, whatever the name", () => {
    expect(sniffType(png(1, 1))).toBe("png");
    expect(sniffType(webpVp8x(512, 512, false))).toBe("webp");
    expect(sniffType(new Uint8Array([0x1f, 0x8b, 8, 0]))).toBe("tgs");
    expect(sniffType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, ...ascii("webm")]))).toBe("webm");
    expect(sniffType(new Uint8Array([0xef, 0xbb, 0xbf, 0x20, 0x0a, ...ascii('{"v":1}')]))).toBe("json");
  });

  test("anything else is unknown", () => {
    expect(sniffType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...ascii("matroska")]))).toBe("unknown");
    expect(sniffType(new Uint8Array(ascii("GIF89a")))).toBe("unknown");
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("unknown");
    expect(sniffType(new Uint8Array([]))).toBe("unknown");
  });

  test("the format each type uploads as", () => {
    expect(formatOf("png")).toBe(ExpressionFormat.Static);
    expect(formatOf("webp")).toBe(ExpressionFormat.Static);
    expect(formatOf("tgs")).toBe(ExpressionFormat.Lottie);
    expect(formatOf("json")).toBe(ExpressionFormat.Lottie);
    expect(formatOf("webm")).toBe(ExpressionFormat.Video);
    expect(formatOf("unknown")).toBeNull();
  });
});

describe("image headers", () => {
  test("PNG size, and APNG found by its acTL chunk", () => {
    expect(pngHeader(png(512, 300))).toEqual({ width: 512, height: 300, animated: false });
    expect(pngHeader(png(100, 100, { animated: true }))).toEqual({ width: 100, height: 100, animated: true });
    expect(pngHeader(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  test("WEBP size from VP8X (with its animation flag), VP8L and VP8", () => {
    expect(webpHeader(webpVp8x(512, 480, false))).toEqual({ width: 512, height: 480, animated: false });
    expect(webpHeader(webpVp8x(100, 100, true))).toEqual({ width: 100, height: 100, animated: true });
    expect(webpHeader(webpVp8l(300, 512))).toEqual({ width: 300, height: 512, animated: false });
    expect(webpHeader(webpVp8(512, 512))).toEqual({ width: 512, height: 512, animated: false });
  });
});

describe("checkSize", () => {
  const ok = (kind: ExpressionKind, type: Parameters<typeof checkSize>[1], size: number) => checkSize(kind, type, size) === null;

  test("emoji: static 128 KB, TGS 64 KB, WEBM 256 KB", () => {
    expect(ok(Emoji, "png", 128 * KB)).toBe(true);
    expect(ok(Emoji, "webp", 128 * KB + 1)).toBe(false);
    expect(ok(Emoji, "tgs", 64 * KB)).toBe(true);
    expect(ok(Emoji, "tgs", 64 * KB + 1)).toBe(false);
    expect(ok(Emoji, "webm", 256 * KB)).toBe(true);
    expect(ok(Emoji, "webm", 256 * KB + 1)).toBe(false);
  });

  test("stickers: static 512 KB, TGS 64 KB, WEBM 256 KB", () => {
    expect(ok(Sticker, "png", 512 * KB)).toBe(true);
    expect(ok(Sticker, "png", 512 * KB + 1)).toBe(false);
    expect(ok(Sticker, "tgs", 64 * KB + 1)).toBe(false);
    expect(ok(Sticker, "webm", 256 * KB + 1)).toBe(false);
  });

  test("plain Lottie JSON is held to 4 MB here (its gzipped size to the TGS cap later)", () => {
    expect(ok(Sticker, "json", 1024 * KB)).toBe(true);
    expect(ok(Sticker, "json", 4 * 1024 * KB + 1)).toBe(false);
  });

  test("the refusal says how large and what the cap is", () => {
    expect(checkSize(Emoji, "png", 200 * KB)).toEqual({
      rejected: true,
      key: "expression_settings_upload_error_size",
      params: { size: "200 KB", max: "128 KB" },
    });
    expect(checkSize(Emoji, "unknown", 1)?.key).toBe("expression_settings_upload_error_type");
  });
});

describe("checkDimensions", () => {
  const fits = (kind: ExpressionKind, format: ExpressionFormat, w: number, h: number) => checkDimensions(kind, format, w, h) === null;

  test("emoji are exactly 100×100, whatever the format", () => {
    for (const format of [ExpressionFormat.Static, ExpressionFormat.Lottie, ExpressionFormat.Video]) {
      expect(fits(Emoji, format, 100, 100)).toBe(true);
      expect(fits(Emoji, format, 100, 99)).toBe(false);
      expect(fits(Emoji, format, 512, 512)).toBe(false);
    }
    expect(checkDimensions(Emoji, ExpressionFormat.Static, 64, 64)).toEqual({
      rejected: true,
      key: "expression_settings_upload_error_dims_emoji",
      params: { width: 64, height: 64 },
    });
  });

  test("static and video stickers: one side exactly 512, the other at most 512", () => {
    for (const format of [ExpressionFormat.Static, ExpressionFormat.Video]) {
      expect(fits(Sticker, format, 512, 512)).toBe(true);
      expect(fits(Sticker, format, 512, 300)).toBe(true);
      expect(fits(Sticker, format, 1, 512)).toBe(true);
      expect(fits(Sticker, format, 400, 400)).toBe(false);
      expect(fits(Sticker, format, 513, 100)).toBe(false);
    }
    expect(checkDimensions(Sticker, ExpressionFormat.Static, 400, 400)?.key).toBe("expression_settings_upload_error_dims_sticker");
  });

  test("Lottie stickers are 512×512", () => {
    expect(fits(Sticker, ExpressionFormat.Lottie, 512, 512)).toBe(true);
    expect(checkDimensions(Sticker, ExpressionFormat.Lottie, 512, 300)?.key).toBe("expression_settings_upload_error_dims_lottie");
  });

  test("three seconds at most, unknown lengths left to the server", () => {
    expect(checkDuration(3)).toBeNull();
    expect(checkDuration(3.0005)).toBeNull();
    expect(checkDuration(3.2)?.key).toBe("expression_settings_upload_error_duration");
    expect(checkDuration(Infinity)).toBeNull();
    expect(checkDuration(null)).toBeNull();
  });
});

describe("inspectLottieJson", () => {
  test("a valid sticker animation", () => {
    expect(inspectLottieJson(lottie(), Sticker)).toEqual({ width: 512, height: 512, duration: 2, fps: 30 });
  });

  test("emoji animations are 100×100", () => {
    expect(isRejection(inspectLottieJson(lottie(), Emoji))).toBe(true);
    expect(isRejection(inspectLottieJson(lottie({ w: 100, h: 100 }), Emoji))).toBe(false);
  });

  test("frame rate, frame range and length", () => {
    expect((inspectLottieJson(lottie({ fr: 0 }), Sticker) as { key: string }).key).toBe("expression_settings_upload_error_fps");
    expect((inspectLottieJson(lottie({ fr: 61 }), Sticker) as { key: string }).key).toBe("expression_settings_upload_error_fps");
    expect((inspectLottieJson(lottie({ op: 0 }), Sticker) as { key: string }).key).toBe("expression_settings_upload_error_lottie_invalid");
    expect((inspectLottieJson(lottie({ op: 91 }), Sticker) as { key: string }).key).toBe("expression_settings_upload_error_duration");
    expect(isRejection(inspectLottieJson(lottie({ fr: 60, op: 180 }), Sticker))).toBe(false);
  });

  test("not a Lottie at all", () => {
    expect(isRejection(inspectLottieJson([], Sticker))).toBe(true);
    expect(isRejection(inspectLottieJson({ w: 512, h: 512 }, Sticker))).toBe(true);
    expect(isRejection(inspectLottieJson(lottie({ layers: undefined }), Sticker))).toBe(true);
  });

  test("features stickers cannot have", () => {
    const refused = (json: unknown) => (inspectLottieJson(json, Sticker) as { key?: string }).key === "expression_settings_upload_error_lottie_features";
    expect(refused(lottie({ layers: [{ ty: 2 }] }))).toBe(true); // image layer
    expect(refused(lottie({ layers: [{ ty: 5 }] }))).toBe(true); // text layer
    expect(refused(lottie({ ddd: 1 }))).toBe(true); // 3D
    expect(refused(lottie({ layers: [{ ty: 4, ks: { o: { a: 0, k: 100, x: "time * 2" } } }] }))).toBe(true); // expression
    expect(refused(lottie({ layers: [{ ty: 4, shapes: [{ ty: "gr", it: [{ ty: "gs" }] }] }] }))).toBe(true); // gradient stroke
    expect(refused(lottie({ layers: [{ ty: 4, sr: 2 }] }))).toBe(true); // time stretch
    expect(refused(lottie({ assets: [{ id: "img", p: "img.png" }] }))).toBe(true); // image asset
    expect(refused(lottie({ layers: [{ ty: 4, shapes: [{ ty: "gr", it: [{ ty: "rc" }, { ty: "fl" }] }] }] }))).toBe(false);
    expect(refused(lottie({ assets: [{ id: "comp", layers: [{ ty: 4 }] }] }))).toBe(false);
  });
});

describe("inspectExpressionFile", () => {
  test("the type, size and canvas are refused before anything is decoded", async () => {
    expect((await inspectExpressionFile(new Blob([new Uint8Array(ascii("GIF89a"))]), Emoji)) as { key: string }).toMatchObject({
      key: "expression_settings_upload_error_type",
    });
    expect(await inspectExpressionFile(new Blob([png(64, 64)]), Emoji)).toMatchObject({ key: "expression_settings_upload_error_dims_emoji" });
    expect(await inspectExpressionFile(new Blob([png(100, 100, { animated: true })]), Emoji)).toMatchObject({
      key: "expression_settings_upload_error_animated_image",
    });
    const big = new Uint8Array(129 * KB);
    big.set(png(100, 100));
    expect(await inspectExpressionFile(new Blob([big]), Emoji)).toMatchObject({ key: "expression_settings_upload_error_size" });
  });

  test("a Lottie is read (gzipped or not) and checked", async () => {
    const json = new TextEncoder().encode(JSON.stringify(lottie({ w: 100, h: 100 })));
    const gz = await gzipped(json);
    const tgs = await inspectExpressionFile(new Blob([gz]), Emoji);
    expect(tgs).toMatchObject({ type: "tgs", format: ExpressionFormat.Lottie, width: 100, height: 100, contentType: "application/x-tgsticker" });

    const wrong = await inspectExpressionFile(new Blob([gz]), Sticker);
    expect(wrong).toMatchObject({ key: "expression_settings_upload_error_dims_lottie" });

    expect(await inspectExpressionFile(new Blob([new TextEncoder().encode("{ not json")]), Emoji)).toMatchObject({
      key: "expression_settings_upload_error_lottie_invalid",
    });
  });
});

describe("names, emoji and keywords", () => {
  test("emoji names: [a-z0-9_], 2 to 32", () => {
    expect(itemNameError(Emoji, "ok")).toBeNull();
    expect(itemNameError(Emoji, "party_parrot_2")).toBeNull();
    expect(itemNameError(Emoji, "a")).toBe("expression_settings_name_length_emoji");
    expect(itemNameError(Emoji, "a".repeat(33))).toBe("expression_settings_name_length_emoji");
    expect(itemNameError(Emoji, "Party")).toBe("expression_settings_name_chars");
    expect(itemNameError(Emoji, "par-ty")).toBe("expression_settings_name_chars");
  });

  test("sticker names: plain text, 2 to 30, no spaces at the ends", () => {
    expect(itemNameError(Sticker, "Happy cat")).toBeNull();
    expect(itemNameError(Sticker, "x")).not.toBeNull();
    expect(itemNameError(Sticker, " cat")).not.toBeNull();
    expect(itemNameError(Sticker, "a".repeat(31))).not.toBeNull();
    expect(itemNameError(Sticker, "tab\there")).not.toBeNull();
  });

  test("pack titles and slugs", () => {
    expect(packTitleError("Cats")).toBeNull();
    expect(packTitleError("")).not.toBeNull();
    expect(packTitleError("x".repeat(65))).not.toBeNull();
    expect(packSlugError("cats_2")).toBeNull();
    expect(packSlugError("Cats")).not.toBeNull();
    expect(packSlugError("x".repeat(65))).not.toBeNull();
    expect(slugify("Happy Cats! Vol. 2")).toBe("happy_cats_vol_2");
    expect(slugify("Café déjà vu")).toBe("cafe_deja_vu");
  });

  test("associated emoji are optional, at most 20; at most 20 keywords, 64 characters in all", () => {
    expect(associatedEmojiError([])).toBeNull();
    expect(associatedEmojiError(["😀"])).toBeNull();
    expect(associatedEmojiError(Array(20).fill("😀"))).toBeNull();
    expect(associatedEmojiError(Array(21).fill("😀"))).toBe("expression_settings_emoji_too_many");
    expect(associatedEmojiError([" "])).toBe("expression_settings_emoji_invalid");
    expect(associatedEmojiError(["x".repeat(33)])).toBe("expression_settings_emoji_invalid");
    expect(keywordsError([])).toBeNull();
    expect(keywordsError(Array(21).fill("a"))).toBe("expression_settings_keywords_too_many");
    expect(keywordsError(["a".repeat(40), "b".repeat(25)])).toBe("expression_settings_keywords_too_long");
  });

  test("emoji pulled out of typed text, whole graphemes, once each", () => {
    expect(extractEmoji("hi 👍🏽 and 🇺🇦, ❤️ 👍🏽 1")).toEqual(["👍🏽", "🇺🇦", "❤️"]);
    expect(extractEmoji("no emoji")).toEqual([]);
  });

  test("names suggested from file names", () => {
    expect(suggestItemName(Emoji, "Party Parrot.png")).toBe("party_parrot");
    expect(suggestItemName(Emoji, "party.png", new Set(["party", "party_2"]))).toBe("party_3");
    expect(suggestItemName(Emoji, "😀.png")).toBe("emoji");
    expect(suggestItemName(Sticker, "  Happy   cat .webp")).toBe("Happy cat");
    expect(suggestItemName(Sticker, "a.webp")).toBe("sticker");
  });

  test("quotas by boost level", () => {
    expect(quotaFor(0)).toEqual({ emoji: 60, stickers: 6, packs: 10 });
    expect(quotaFor(3)).toEqual({ emoji: 300, stickers: 72, packs: 10 });
    expect(quotaFor(9)).toEqual(quotaFor(3));
    expect(packItemLimit(Emoji)).toBe(200);
    expect(packItemLimit(Sticker)).toBe(120);
  });
});
