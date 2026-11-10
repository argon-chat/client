import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type InjectionKey } from "vue";
import { getAnimationIntersector, type AnimationControl } from "@/lib/expressions/animationIntersector";
import { prefersReducedMotion } from "@/lib/expressions/settings";

/**
 * vue-native only: the `play` attribute of a `<vn-sticker>`, from the same AnimationIntersector policy
 * the browser players follow (groups and their locks, the picker's autoplay setting, animations off,
 * the page hidden or the window left, a hover or click that plays). The item has no element: vue-native knows what is on
 * screen and plays only that, so the intersector sees it as always visible.
 */
export function useVnStickerPlay(options: { group: () => string; autoplay: () => boolean | undefined }) {
  const playing = ref(false);
  let control: AnimationControl | null = null;

  const autoplay = () => options.autoplay() ?? !prefersReducedMotion();
  function add(group: string) {
    control?.remove();
    control = getAnimationIntersector().add({
      el: null,
      initiallyVisible: true,
      group,
      autoplay: autoplay(),
      setPlaying: (value) => (playing.value = value),
    });
  }

  add(options.group());
  watch(options.group, add);
  watch(options.autoplay, () => control?.setAutoplay(autoplay()));
  onBeforeUnmount(() => {
    control?.remove();
    control = null;
  });

  return {
    /** The attribute: `on` while the policy plays it, `off` (the first frame) otherwise. */
    mode: computed(() => (playing.value ? "on" : "off")),
    /** A hover or a click: plays even without autoplay. */
    play: () => control?.play(),
    /** Holds it on the first frame until `play()`. */
    pause: () => control?.pause(),
  };
}

/**
 * vue-native only: a `CustomEmojiOverlay`'s play mode, shared by the `CustomEmojiInline`s inside it
 * (one policy item per overlay, as the browser has one player per file and group).
 */
export const VN_EMOJI_PLAY: InjectionKey<ComputedRef<"on" | "off">> = Symbol("vn-emoji-play");
