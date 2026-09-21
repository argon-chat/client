import { defineTextEffect } from "@/cosmetics/textEffect";

/**
 * A highlight travelling across the letters, and the reason a treatment may carry keyframes.
 *
 * <b>Not the same as the wearer's own "travelling".</b> That one slides their colours along the
 * name; this sweeps a bright band across whatever colours are there. They compose — a travelling
 * gradient with a highlight running over it — and the two have to be named so nobody reads them as
 * the same switch offered twice.
 *
 * Its animation is dropped under a reduced-motion preference by the renderer, which leaves the
 * colours standing rather than taking the treatment away.
 */
export default defineTextEffect({
  slug: "shimmer",

  style: ({ stops, tint, lighten, shade, gradient }) => {
    // Laid out twice so the sweep loops with no jump: the band leaves one copy and enters the next.
    const laid = stops.length > 1
      ? [...stops, ...stops]
      : tint
        ? [shade(tint, 0.25), lighten(tint, 0.6), shade(tint, 0.25)]
        : null;

    if (!laid) return null;

    return {
      ...gradient(...laid),
      backgroundSize: "250% 100%",
      animation: "cosmetic-shimmer 4s linear infinite",
    };
  },

  keyframes: `@keyframes cosmetic-shimmer {
  from { background-position: 0 0; }
  to { background-position: -250% 0; }
}`,
});
