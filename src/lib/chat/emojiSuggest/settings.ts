import { computed, shallowRef, type WritableComputedRef } from "vue";
import { persisted, type PersistedRef } from "@argon/storage";
import { userScopedKey } from "@/lib/userScopedStorage";
import { onSessionReset } from "@/store/system/sessionLifecycle";

// Per user, all on until turned off.

export const EMOJI_SUGGESTIONS_KEY = "argon_emoji_suggestions";
export const SUGGEST_EMOJI_KEY = "argon_emoji_suggest";
export const REPLACE_EMOTICONS_KEY = "argon_emoji_replace_emoticons";
export const SUGGEST_CUSTOM_EMOJI_KEY = "argon_emoji_suggest_custom";
export const SUGGEST_STICKERS_KEY = "argon_emoji_suggest_stickers";

const KEYS = {
  enabled: EMOJI_SUGGESTIONS_KEY,
  suggestEmoji: SUGGEST_EMOJI_KEY,
  replaceEmoticons: REPLACE_EMOTICONS_KEY,
  suggestCustomEmoji: SUGGEST_CUSTOM_EMOJI_KEY,
  suggestStickers: SUGGEST_STICKERS_KEY,
} as const;

type Name = keyof typeof KEYS;

const openAll = () =>
  Object.fromEntries(Object.entries(KEYS).map(([name, key]) => [name, persisted<boolean>(userScopedKey(key), true)])) as Record<
    Name,
    PersistedRef<boolean>
  >;

const stores = shallowRef(openAll());
onSessionReset(() => {
  stores.value = openAll();
});

const setting = (name: Name): WritableComputedRef<boolean> =>
  computed({
    get: () => stores.value[name].value !== false,
    set: (value) => stores.value[name].set(value),
  });

/**
 * The master switch. Off, none of the four below applies: no keyword data is loaded (what was is
 * released), nothing is suggested, emoticons and `:codes:` stay as typed, and the strip is not
 * mounted. The typographic table (`--` → —) still applies.
 */
export const emojiSuggestionsEnabled = setting("enabled");
/** `:query` and a lone word suggest unicode emoji. */
export const suggestEmoji = setting("suggestEmoji");
/** `:)`, `:D ` and `:joy:` turn into emoji as typed. */
export const replaceEmoticons = setting("replaceEmoticons");
/** The space's custom emoji in the strip, and for an emoji just typed. */
export const suggestCustomEmoji = setting("suggestCustomEmoji");
/** A message of one emoji offers stickers tagged with it. */
export const suggestStickers = setting("suggestStickers");
