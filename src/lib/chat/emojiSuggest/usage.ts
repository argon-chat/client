import { shallowRef } from "vue";
import { persisted } from "@argon/storage";
import { userScopedKey } from "@/lib/userScopedStorage";
import { onSessionReset } from "@/store/system/sessionLifecycle";

// How often the user picks each emoji, as tdesktop keeps it: a small map of ratings that decays by
// halving, so recent habits outweigh old ones.

export const EMOJI_USAGE_KEY = "argon_emoji_usage";
export const USAGE_MAX_KEYS = 54;
export const USAGE_HALVE_ABOVE = 0x4000;

export type Ratings = Readonly<Record<string, number>>;

/** `key` one higher; the lowest other key goes when over the cap; all halve once one passes the limit. */
export function bumpRating(ratings: Ratings, key: string): Record<string, number> {
  const next: Record<string, number> = { ...ratings, [key]: (ratings[key] ?? 0) + 1 };
  const keys = Object.keys(next);
  if (keys.length > USAGE_MAX_KEYS) {
    let lowest: string | null = null;
    for (const k of keys) if (k !== key && (lowest === null || next[k] < next[lowest])) lowest = k;
    if (lowest !== null) delete next[lowest];
  }
  if (next[key] > USAGE_HALVE_ABOVE) {
    for (const k of Object.keys(next)) next[k] = Math.max(1, Math.floor(next[k] / 2));
  }
  return next;
}

const open = () => persisted<Record<string, number>>(userScopedKey(EMOJI_USAGE_KEY), {});
const store = shallowRef(open());
onSessionReset(() => {
  store.value = open();
});

function current(): Ratings {
  const value = store.value.value;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** `u:<hexcode>` (base emoji) or `c:<itemId>`. */
export function usageRating(key: string): number {
  return current()[key] ?? 0;
}

export function bumpUsage(key: string): void {
  store.value.set(bumpRating(current(), key));
}
