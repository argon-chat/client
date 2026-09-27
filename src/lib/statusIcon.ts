import type { ExpressionItem, StatusEmoji, UserEditInput } from "@argon/glue";
import type { ExpressionMedia } from "@/lib/expressions/types";

/**
 * A custom status's icon as the server keeps it (`customStatusIconId`): empty for none, a unicode
 * emoji, or `ce:<itemId>` for a custom emoji, whose file the profile carries as `customStatusEmoji`.
 */

export const CUSTOM_EMOJI_ICON_PREFIX = "ce:";

export const customEmojiIconId = (itemId: string): string => `${CUSTOM_EMOJI_ICON_PREFIX}${itemId}`;

export interface StatusIconSource {
  customStatusIconId?: string | null;
  customStatusEmoji?: StatusEmoji | null;
}

export type StatusIconView =
  | { type: "custom"; media: ExpressionMedia; name: string }
  | { type: "unicode"; text: string };

/** Custom emoji are 100×100 art; the status draws them at a fixed box anyway. */
export function statusEmojiMedia(emoji: StatusEmoji): ExpressionMedia {
  return { fileId: emoji.fileId, format: emoji.format as number as ExpressionMedia["format"], width: 100, height: 100 };
}

export function statusEmojiOf(item: ExpressionItem): StatusEmoji {
  return { itemId: item.itemId, spaceId: item.spaceId, fileId: item.fileId, format: item.format, name: item.name };
}

/**
 * What the icon draws as: the custom emoji the profile carries, else a unicode icon. A `ce:` id
 * without its emoji (deleted since, or an old cached row) draws nothing.
 */
export function statusIconView(profile: StatusIconSource | null | undefined): StatusIconView | null {
  const emoji = profile?.customStatusEmoji;
  if (emoji) return { type: "custom", media: statusEmojiMedia(emoji), name: emoji.name };
  const iconId = profile?.customStatusIconId;
  if (iconId && !iconId.startsWith(CUSTOM_EMOJI_ICON_PREFIX)) return { type: "unicode", text: iconId };
  return null;
}

/** Text, an icon, or both: a status may be an emoji alone. */
export function hasCustomStatus(profile: (StatusIconSource & { customStatus?: string | null }) | null | undefined): boolean {
  return !!profile?.customStatus || statusIconView(profile) !== null;
}

export interface StatusDraft {
  text: string;
  /** "" for none. */
  iconId: string;
}

export interface SavedStatus {
  customStatus: string | null;
  customStatusIconId: string | null;
}

/**
 * The status half of an UpdateMe: null for what did not change, "" to clear. The server clears the
 * icon along with the text unless the same edit sets one, so an icon kept on its own is sent again.
 */
export function statusEdit(draft: StatusDraft, saved: SavedStatus): Pick<UserEditInput, "customStatus" | "customStatusIconId"> {
  const textChanged = draft.text !== (saved.customStatus ?? "");
  const iconChanged = draft.iconId !== (saved.customStatusIconId ?? "");
  const iconAlone = textChanged && draft.text === "" && draft.iconId !== "";
  return {
    customStatus: textChanged ? draft.text : null,
    customStatusIconId: iconChanged || iconAlone ? draft.iconId : null,
  };
}
