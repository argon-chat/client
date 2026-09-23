import { defineTextEffect } from "@/cosmetics/textEffect";

/**
 * The name with a halo around it.
 *
 * <b>`color-mix` rather than a hex suffix.</b> The faint outer ring used to be written by tacking
 * `80` onto the colour, which is only alpha if the colour happens to be a six-digit hex — and a role
 * colour arrives as `rgb(…)`, which made the whole `text-shadow` invalid and dropped the glow
 * entirely. Nobody saw an error; the treatment simply did nothing for anyone who had not chosen
 * colours of their own.
 *
 * The halo is drawn behind the glyphs, so it shows through even when the letters themselves are a
 * gradient clipped to their shape.
 */
export default defineTextEffect({
  slug: "glow",

  style: ({ stops, tint, gradient }): Record<string, string> | null => {
    if (stops.length > 1) {
      const halo = stops[Math.floor(stops.length / 2)];

      return {
        ...gradient(...stops),
        textShadow: `0 0 5px ${halo}, 0 0 14px ${fade(halo)}`,
      };
    }

    return tint ? { color: tint, textShadow: `0 0 4px ${tint}, 0 0 12px ${fade(tint)}` } : null;
  },
});

/** The same colour at half strength, for the wide outer ring of the halo. */
function fade(colour: string): string {
  return `color-mix(in srgb, ${colour} 50%, transparent)`;
}
