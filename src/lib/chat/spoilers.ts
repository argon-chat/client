import { EntityType, type IMessageEntity } from "@argon/glue";

/** What a preview shows in place of a spoiler: the same whatever its length, so that is hidden too. */
export const SPOILER_MASK = "▒▒▒▒▒";

/**
 * A message's text for a plain-text preview (a pinned row, the space's announcement banner), with
 * every spoiler range (`MessageEntitySpoiler`, written `||…||`) replaced by {@link SPOILER_MASK}.
 * The chat itself hides them behind a click; a preview has nothing to click.
 */
export function maskSpoilers(text: string, entities: readonly IMessageEntity[] | null | undefined): string {
  const ranges = (entities ?? [])
    .filter((e) => e.type === EntityType.Spoiler)
    .map((e) => [Math.max(0, e.offset), Math.min(text.length, e.offset + e.length)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  if (ranges.length === 0) return text;

  let out = "";
  let pos = 0;
  for (const [start, end] of ranges) {
    if (end <= pos) continue;
    if (start >= pos) out += text.slice(pos, start) + SPOILER_MASK;
    pos = end;
  }
  return out + text.slice(pos);
}
