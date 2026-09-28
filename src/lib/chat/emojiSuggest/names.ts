import type { KeywordIndex, KeywordMatch } from "@argon-chat/emojix";
import { baseHexcode } from "./emoji";

type Matcher = Pick<KeywordIndex, "matchExact" | "matchPrefix">;

/**
 * Base emoji a custom emoji's name suggests (`pepe_cry` → 😢): the whole name as a phrase, then
 * each part's exact matches taken in turn, then prefix matches. Base hexcodes, at most `limit`.
 */
export function emojiForName(name: string, index: Matcher, limit = 3): string[] {
  const parts = name
    .toLowerCase()
    .split(/[_\-\s]+/)
    .filter((p) => p.length >= 2);
  const out: string[] = [];
  const add = (m: KeywordMatch) => {
    const hex = baseHexcode(m.hexcode);
    if (out.length < limit && !out.includes(hex)) out.push(hex);
  };
  if (parts.length > 1) index.matchExact(parts.join(" ")).forEach(add);
  const rounds = (lists: KeywordMatch[][]) => {
    const longest = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < longest && out.length < limit; i++) for (const list of lists) if (list[i]) add(list[i]);
  };
  rounds(parts.map((p) => index.matchExact(p)));
  rounds(parts.map((p) => index.matchPrefix(p, limit)));
  return out;
}
