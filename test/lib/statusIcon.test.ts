/**
 * The custom status's icon: what a status save sends (null leaves a field alone, "" clears it, and the
 * server clears the icon with the text unless the same edit sets one), what a profile's icon draws
 * as, and the toast for a refused one.
 */

import { describe, test, expect } from "vitest";
import { ExpressionFormat, ExpressionKind, UpdateMeError, type ExpressionItem, type StatusEmoji } from "@argon/glue";
import {
  customEmojiIconId,
  hasCustomStatus,
  statusEdit,
  statusEmojiOf,
  statusIconView,
} from "@/lib/statusIcon";
import { updateMeErrorKey } from "@/lib/refusals";

const ITEM_ID = "0192f0c1-7a3e-7c55-9b7e-2f1d3c4b5a69";

const emoji: StatusEmoji = {
  itemId: ITEM_ID,
  spaceId: "space-cats",
  fileId: "file-blob",
  format: ExpressionFormat.Lottie,
  name: "blob_wave",
};

const saved = (customStatus: string | null, customStatusIconId: string | null) => ({ customStatus, customStatusIconId });

describe("what a status save sends", () => {
  test("nothing changed: null for both, so the server leaves them (and the premium check) alone", () => {
    expect(statusEdit({ text: "at work", iconId: "☕" }, saved("at work", "☕"))).toEqual({ customStatus: null, customStatusIconId: null });
    expect(statusEdit({ text: "", iconId: "" }, saved(null, null))).toEqual({ customStatus: null, customStatusIconId: null });
  });

  test("cleared: \"\" for both, not null (null was 'unchanged' and never cleared)", () => {
    expect(statusEdit({ text: "", iconId: "" }, saved("at work", "☕"))).toEqual({ customStatus: "", customStatusIconId: "" });
    expect(statusEdit({ text: "at work", iconId: "" }, saved("at work", "☕"))).toEqual({ customStatus: null, customStatusIconId: "" });
  });

  test("a unicode icon: the emoji itself", () => {
    expect(statusEdit({ text: "at work", iconId: "🍕" }, saved("at work", null))).toEqual({ customStatus: null, customStatusIconId: "🍕" });
  });

  test("a custom emoji: ce:<itemId>", () => {
    expect(statusEdit({ text: "at work", iconId: customEmojiIconId(ITEM_ID) }, saved("at work", "☕"))).toEqual({
      customStatus: null,
      customStatusIconId: `ce:${ITEM_ID}`,
    });
  });

  test("the text emptied under a kept icon: the icon is sent again, or the server would drop it", () => {
    expect(statusEdit({ text: "", iconId: "☕" }, saved("at work", "☕"))).toEqual({ customStatus: "", customStatusIconId: "☕" });
  });
});

describe("what a profile's status icon draws as", () => {
  test("the custom emoji the profile carries, as a 100×100 sticker of its file", () => {
    expect(statusIconView({ customStatusIconId: `ce:${ITEM_ID}`, customStatusEmoji: emoji })).toEqual({
      type: "custom",
      media: { fileId: "file-blob", format: ExpressionFormat.Lottie, width: 100, height: 100 },
      name: "blob_wave",
    });
  });

  test("a unicode icon as itself", () => {
    expect(statusIconView({ customStatusIconId: "🍕", customStatusEmoji: null })).toEqual({ type: "unicode", text: "🍕" });
  });

  test("nothing: no icon, an empty one, or a ce: id whose emoji is gone", () => {
    expect(statusIconView(null)).toBeNull();
    expect(statusIconView({ customStatusIconId: null, customStatusEmoji: null })).toBeNull();
    expect(statusIconView({ customStatusIconId: "", customStatusEmoji: null })).toBeNull();
    expect(statusIconView({ customStatusIconId: `ce:${ITEM_ID}`, customStatusEmoji: null })).toBeNull();
    // A row cached before the field existed.
    expect(statusIconView({ customStatusIconId: `ce:${ITEM_ID}` })).toBeNull();
  });

  test("a status is text, an icon, or both", () => {
    expect(hasCustomStatus({ customStatus: "at work", customStatusIconId: null, customStatusEmoji: null })).toBe(true);
    expect(hasCustomStatus({ customStatus: "", customStatusIconId: "☕", customStatusEmoji: null })).toBe(true);
    expect(hasCustomStatus({ customStatus: null, customStatusIconId: `ce:${ITEM_ID}`, customStatusEmoji: emoji })).toBe(true);
    expect(hasCustomStatus({ customStatus: "", customStatusIconId: "", customStatusEmoji: null })).toBe(false);
  });

  test("a picked custom emoji becomes the profile's own copy of it", () => {
    const item = { ...emoji, packId: "pack", kind: ExpressionKind.Emoji, width: 128, height: 128 } as unknown as ExpressionItem;
    expect(statusEmojiOf(item)).toEqual(emoji);
  });
});

describe("a refused status icon", () => {
  test("says why; anything else keeps the generic message", () => {
    expect(updateMeErrorKey(UpdateMeError.INVALID_STATUS_EMOJI)).toBe("status_emoji_invalid");
    expect(updateMeErrorKey(UpdateMeError.COOLDOWN_ACTIVE)).toBe("profile_update_failed");
    expect(updateMeErrorKey(99 as UpdateMeError)).toBe("profile_update_failed");
  });
});
