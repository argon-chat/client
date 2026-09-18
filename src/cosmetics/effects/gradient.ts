import { defineTextEffect } from "@/cosmetics/textEffect";

/**
 * The colours blended into one another.
 *
 * With several colours there is nothing to invent — they are the blend, and this paints them. With
 * one, it makes the second: a lighter tone of what was chosen, so a single colour still reads as a
 * gradient rather than as flat paint.
 */
export default defineTextEffect({
  slug: "gradient",

  style: ({ stops, tint, lighten, gradient }) => {
    if (stops.length > 1) return gradient(...stops);

    return tint ? gradient(tint, lighten(tint, 0.45)) : null;
  },
});
