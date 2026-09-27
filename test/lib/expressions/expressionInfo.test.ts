/**
 * What the attribution popover says about a custom emoji or sticker: its name, its pack and its
 * space, from what this client has loaded. An item from a space the user is not in is unknown here:
 * the name the message carries, and "from another space". "Open pack" only where the user is a
 * member, and only for a pack the registered composer's picker shows.
 */

import { describe, test, expect, afterEach } from "vitest";
import { computed, ref } from "vue";
import { ExpressionKind, type ExpressionItem, type ExpressionPack } from "@argon/glue";
import { noopResolver, type ExpressionResolver } from "@/lib/expressions/resolver";
import {
  canOpenExpressionPack,
  describeExpression,
  onOpenExpressionPack,
  openExpressionPack,
  resolveExpressionInfo,
  type ExpressionInfoTarget,
} from "@/lib/expressions/expressionInfo";

const item = (over: Partial<ExpressionItem> = {}) =>
  ({ itemId: "i-blob", packId: "p-blobs", spaceId: "s-cats", kind: ExpressionKind.Emoji, name: "blob", ...over }) as ExpressionItem;
const pack = (over: Partial<ExpressionPack> = {}) =>
  ({ packId: "p-blobs", spaceId: "s-cats", kind: ExpressionKind.Emoji, title: "Blobs", ...over }) as ExpressionPack;
const cats = { spaceId: "s-cats", name: "Cats", avatarFieldId: "f-cats" };

function resolverOf(items: ExpressionItem[], packs: ExpressionPack[]): ExpressionResolver {
  return {
    ...noopResolver,
    itemById: (id) => items.find((i) => i.itemId === id) ?? null,
    packOf: (i) => packs.find((p) => p.packId === i.packId) ?? null,
  };
}

const emoji = (over: Partial<ExpressionInfoTarget> = {}): ExpressionInfoTarget => ({ kind: "emoji", itemId: "i-blob", spaceId: "s-cats", name: "blob", ...over });

describe("resolveExpressionInfo", () => {
  test("a known emoji in its own space: name, pack, space, here, and where Open pack goes", () => {
    const info = resolveExpressionInfo(emoji(), resolverOf([item()], [pack()]), cats, "s-cats");
    expect(info).toMatchObject({
      kind: "emoji",
      label: ":blob:",
      copyText: ":blob:",
      packTitle: "Blobs",
      space: { spaceId: "s-cats", name: "Cats", avatarFileId: "f-cats" },
      here: true,
      openPack: { spaceId: "s-cats", packId: "p-blobs", kind: ExpressionKind.Emoji },
    });
    expect(info.item?.itemId).toBe("i-blob");
  });

  test("the item's current name wins over the one the message carried", () => {
    const info = resolveExpressionInfo(emoji({ name: "old_name" }), resolverOf([item({ name: "blob" })], [pack()]), cats, "s-cats");
    expect(info.label).toBe(":blob:");
  });

  test("an unknown item (another space, not loaded): the message's name, no pack, no space, no action", () => {
    const info = resolveExpressionInfo(emoji({ itemId: "i-party", spaceId: "s-far", name: "party" }), resolverOf([item()], [pack()]), undefined, "s-cats");
    expect(info).toMatchObject({ item: null, label: ":party:", copyText: ":party:", packTitle: null, space: null, here: false, openPack: null });
  });

  test("in a DM: the emoji's own space is shown, not 'this space', and its pack can be opened", () => {
    const info = resolveExpressionInfo(emoji(), resolverOf([item()], [pack()]), cats, null);
    expect(info).toMatchObject({ label: ":blob:", packTitle: "Blobs", space: { name: "Cats" }, here: false, openPack: { packId: "p-blobs" } });
  });

  test("in a DM with an emoji from a space the user is not in: from another space", () => {
    const info = resolveExpressionInfo(emoji({ itemId: "i-x", spaceId: "s-far", name: "x" }), resolverOf([], []), undefined, null);
    expect(info).toMatchObject({ label: ":x:", space: null, here: false, openPack: null });
  });

  test("known item but no longer a member of its space: the pack still shows, the space and the action do not", () => {
    const info = resolveExpressionInfo(emoji(), resolverOf([item()], [pack()]), null, "s-other");
    expect(info).toMatchObject({ packTitle: "Blobs", space: null, openPack: null });
  });

  test("a space row for another space does not count", () => {
    const info = resolveExpressionInfo(emoji(), resolverOf([item()], [pack()]), { ...cats, spaceId: "s-dogs" }, "s-cats");
    expect(info.space).toBeNull();
    expect(info.openPack).toBeNull();
  });

  test("a resolver without packOf still names the item", () => {
    const info = resolveExpressionInfo(emoji(), { ...noopResolver, itemById: () => item() }, cats, "s-cats");
    expect(info).toMatchObject({ label: ":blob:", packTitle: null, openPack: null, space: { name: "Cats" } });
  });
});

describe("describeExpression", () => {
  test("stickers: the name as it is, no copy; unknown: no name", () => {
    const sticker = item({ itemId: "i-cat", name: "Happy cat", kind: ExpressionKind.Sticker, packId: "p-cats" });
    const known = describeExpression(
      { kind: "sticker", itemId: "i-cat", spaceId: "s-cats" },
      { item: sticker, pack: pack({ packId: "p-cats", title: "Cats", kind: ExpressionKind.Sticker }), space: cats, contextSpaceId: "s-cats" },
    );
    expect(known).toMatchObject({ label: "Happy cat", copyText: null, packTitle: "Cats", openPack: { kind: ExpressionKind.Sticker } });

    const unknown = describeExpression({ kind: "sticker", itemId: "i-cat", spaceId: "s-far" }, { item: null, pack: null, space: undefined, contextSpaceId: "s-cats" });
    expect(unknown).toMatchObject({ label: null, copyText: null, packTitle: null, space: null });
  });

  test("a reaction's `:name:` loses its colons; an empty one is no name", () => {
    const named = describeExpression({ kind: "emoji", itemId: "x", spaceId: null, name: ":party:" }, { item: null, pack: null, space: null, contextSpaceId: null });
    expect(named.label).toBe(":party:");
    const blank = describeExpression({ kind: "emoji", itemId: "x", spaceId: null, name: "" }, { item: null, pack: null, space: null, contextSpaceId: null });
    expect(blank).toMatchObject({ label: null, copyText: null });
  });

  test("a pack that is not the item's is ignored", () => {
    const info = describeExpression(emoji(), { item: item(), pack: pack({ packId: "p-other" }), space: cats, contextSpaceId: null });
    expect(info.packTitle).toBeNull();
    expect(info.openPack).toBeNull();
  });
});

describe("Open pack", () => {
  const off: (() => void)[] = [];
  afterEach(() => off.splice(0).forEach((f) => f()));

  const blobs = { spaceId: "s-cats", packId: "p-blobs", kind: ExpressionKind.Emoji };
  const any = () => true;

  test("unavailable until the composer registers; then the latest handler gets the pack", () => {
    expect(canOpenExpressionPack("p-blobs", "s-cats")).toBe(false);
    expect(openExpressionPack(blobs)).toBe(false);

    const first: unknown[] = [];
    const second: unknown[] = [];
    off.push(onOpenExpressionPack((p) => first.push(p), any));
    const removeSecond = onOpenExpressionPack((p) => second.push(p), any);
    expect(canOpenExpressionPack("p-blobs", "s-cats")).toBe(true);
    expect(openExpressionPack(blobs)).toBe(true);
    expect([first, second]).toEqual([[], [blobs]]);

    removeSecond();
    openExpressionPack(blobs);
    expect(first).toEqual([blobs]);
  });

  test("offered only for a pack the latest composer's picker shows: a channel's, its own space's", () => {
    // A channel composer in s-cats: only that space's packs are in its picker.
    off.push(onOpenExpressionPack(() => true, (_packId, spaceId) => spaceId === "s-cats"));
    expect(canOpenExpressionPack("p-blobs", "s-cats")).toBe(true);
    expect(canOpenExpressionPack("p-dogs", "s-dogs")).toBe(false);

    // A direct chat's composer on top: every loaded space's.
    const removeDm = onOpenExpressionPack(() => true, any);
    expect(canOpenExpressionPack("p-dogs", "s-dogs")).toBe(true);
    removeDm();
    expect(canOpenExpressionPack("p-dogs", "s-dogs")).toBe(false);
  });

  test("a computed over it follows the registry and what the predicate reads", () => {
    const loaded = ref(false);
    const offered = computed(() => canOpenExpressionPack("p-blobs", "s-cats"));
    expect(offered.value).toBe(false);

    const remove = onOpenExpressionPack(() => true, () => loaded.value);
    expect(offered.value).toBe(false);
    loaded.value = true;
    expect(offered.value).toBe(true);

    remove();
    expect(offered.value).toBe(false);
  });
});
