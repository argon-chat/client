import { shallowRef, type InjectionKey, type Ref } from "vue";
import type { ArgonSpaceBase, ExpressionItem, ExpressionKind, ExpressionPack } from "@argon/glue";
import type { ExpressionResolver } from "./resolver";

/**
 * What the attribution popover says about a custom emoji or sticker seen in a message or a reaction:
 * its name, its pack and the space it comes from. Only the ids travel with a message, so the rest
 * comes from what this client has loaded; an item from a space the user is not in stays unknown.
 */

export interface ExpressionInfoTarget {
  kind: "emoji" | "sticker";
  itemId: string;
  /** The item's space as the message carries it; null when nothing says (a reaction). */
  spaceId: string | null;
  /** The name as the message carries it (a custom emoji's entity, a reaction's `:name:`). */
  name?: string | null;
}

export type ExpressionInfoSpace = Pick<ArgonSpaceBase, "spaceId" | "name" | "avatarFieldId">;

export interface ExpressionPackRef {
  spaceId: string;
  packId: string;
  kind: ExpressionKind;
}

export interface ExpressionInfo {
  kind: "emoji" | "sticker";
  item: ExpressionItem | null;
  /** `:name:` for an emoji, the name for a sticker; null when neither the item nor the message has one. */
  label: string | null;
  /** What "Copy" puts on the clipboard: an emoji's `:name:`. */
  copyText: string | null;
  packTitle: string | null;
  /** The item's space, when it is one of the user's. */
  space: { spaceId: string; name: string; avatarFileId: string | null } | null;
  /** The item comes from the space the message is in. */
  here: boolean;
  /** Where "Open pack" goes: a known pack in one of the user's spaces. */
  openPack: ExpressionPackRef | null;
}

export const stripColons = (name: string) => name.replace(/^:+|:+$/g, "");

export interface ExpressionInfoSources {
  item: ExpressionItem | null;
  pack: ExpressionPack | null;
  /** The user's row for the item's space (`db.servers`); absent when they are not in it. */
  space: ExpressionInfoSpace | null | undefined;
  /** The space the message is in; null in a DM. */
  contextSpaceId: string | null;
}

export function describeExpression(target: ExpressionInfoTarget, { item, pack, space, contextSpaceId }: ExpressionInfoSources): ExpressionInfo {
  const rawName = item?.name ?? (target.name ? stripColons(target.name) : null);
  const name = rawName || null;
  const spaceId = item?.spaceId ?? target.spaceId;
  const ownPack = pack && item && pack.packId === item.packId ? pack : null;
  const member = space && spaceId && space.spaceId === spaceId ? space : null;
  const emoji = target.kind === "emoji";
  return {
    kind: target.kind,
    item,
    label: name ? (emoji ? `:${name}:` : name) : null,
    copyText: emoji && name ? `:${name}:` : null,
    packTitle: ownPack?.title || null,
    space: member ? { spaceId: member.spaceId, name: member.name, avatarFileId: member.avatarFieldId ?? null } : null,
    here: !!spaceId && spaceId === contextSpaceId,
    openPack: ownPack && member ? { spaceId: member.spaceId, packId: ownPack.packId, kind: ownPack.kind } : null,
  };
}

/** The item and its pack through the resolver; the space row is looked up by the caller (async). */
export function resolveExpressionInfo(
  target: ExpressionInfoTarget,
  resolver: ExpressionResolver,
  space: ExpressionInfoSpace | null | undefined,
  contextSpaceId: string | null,
): ExpressionInfo {
  const item = resolver.itemById(target.itemId);
  const pack = item ? (resolver.packOf?.(item) ?? null) : null;
  return describeExpression(target, { item, pack, space, contextSpaceId });
}

/** The space of the message being rendered (null in a DM), provided by MessageItem. */
export const EXPRESSION_INFO_SPACE: InjectionKey<Readonly<Ref<string | null>>> = Symbol("expressionInfoSpace");

// ── "Open pack" ──
// The composer owns the picker, and it is not an ancestor of the message list, so it registers here.
// Until something does, the popover offers no "Open pack".

/** Returns false to decline a pack it cannot show (another space's, in a space's composer). */
type PackOpener = (pack: ExpressionPackRef) => unknown;
/** Whether the composer's picker shows that pack. */
type PackPredicate = (packId: string, spaceId: string) => boolean;

interface PackOpenerEntry {
  open: PackOpener;
  canOpen: PackPredicate;
}

const openers = shallowRef<PackOpenerEntry[]>([]);

/**
 * Registers the handler for "Open pack" and the predicate for which packs it takes; the returned
 * function removes both. The latest one wins.
 */
export function onOpenExpressionPack(open: PackOpener, canOpen: PackPredicate): () => void {
  const entry: PackOpenerEntry = { open, canOpen };
  openers.value = [...openers.value, entry];
  return () => {
    openers.value = openers.value.filter((e) => e !== entry);
  };
}

/** Whether "Open pack" would open that pack; reactive when read in a computed. */
export function canOpenExpressionPack(packId: string, spaceId: string): boolean {
  const entry = openers.value.at(-1);
  return !!entry && entry.canOpen(packId, spaceId);
}

/** Whether the pack was opened: false with no handler, or when the handler declined it. */
export function openExpressionPack(pack: ExpressionPackRef): boolean {
  const entry = openers.value.at(-1);
  return !!entry && entry.open(pack) !== false;
}
