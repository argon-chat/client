import { defineTextEffect } from "@/cosmetics/textEffect";

/**
 * A highlight travelling across the letters, and the reason a treatment may carry keyframes.
 *
 * <b>Not the same as the wearer's own "travelling".</b> That one slides their colours along the
 * name; this sweeps a bright band across whatever colours are there. They compose — a travelling
 * gradient with a highlight running over it — and the two have to be named so nobody reads them as
 * the same switch offered twice.
 *
 * <b>So the band is a layer of its own over the colours, not a reshaping of them.</b> The colours
 * stay exactly as the wearer aimed them — travelling or still, linear or from the centre — and only
 * the band moves, on a property of its own so the two motions run side by side.
 *
 * Its animation is dropped under a reduced-motion preference by the renderer, which parks the band
 * off the name and leaves the colours standing rather than taking the treatment away.
 */
export default defineTextEffect({
  slug: "shimmer",

  style: ({ stops, tint, lighten, gradient }) => {
    const colours = stops.length > 1 ? stops : tint ? [tint, tint] : null;

    if (!colours) {
      return null;
    }

    const painted = gradient(...colours);
    const band = `linear-gradient(100deg, transparent 40%, ${lighten(colours[0], 0.6)} 50%, transparent 60%)`;

    return {
      ...painted,
      backgroundImage: `${band}, ${painted.backgroundImage}`,
      backgroundSize: `250% 100%, ${painted.backgroundSize ?? "auto"}`,
      backgroundPosition: `var(--cosmetic-shimmer) 0, ${painted.backgroundPosition ?? "0 0"}`,
      animation: [painted.animation, "cosmetic-shimmer 4s linear infinite"].filter(Boolean).join(", "),
    };
  },

  // From one side of the name to the other: at either end the band lies wholly outside the box.
  keyframes: `@property --cosmetic-shimmer {
  syntax: "<percentage>";
  inherits: false;
  initial-value: 0%;
}

@keyframes cosmetic-shimmer {
  from { --cosmetic-shimmer: 100%; }
  to { --cosmetic-shimmer: 0%; }
}`,
});
