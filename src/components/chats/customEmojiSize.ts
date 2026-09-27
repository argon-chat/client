import type { InjectionKey, Ref } from "vue";

/** The px size of custom emoji in the text below (a message sets it; jumbo emoji are bigger). */
export const CUSTOM_EMOJI_SIZE: InjectionKey<Readonly<Ref<number | null>>> = Symbol("customEmojiSize");
