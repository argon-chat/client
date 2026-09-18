import { defineAsyncComponent } from "vue";
import { defineCosmeticKind } from "@/cosmetics/types";

/**
 * The part of a name's look only its wearer decides.
 *
 * An axis is a list somebody else wrote; this is the colour you picked because it is yours. One stop
 * is flat, two or more are a gradient, and the angle says which way it runs.
 */
export type GradientShape = "linear" | "radial" | "conic";

export interface NicknameStyleTuning {
  stops: string[] | null;
  angle: number | null;
  shape: GradientShape | null;
  animate: boolean | null;
}

const HEX = /^#[0-9a-f]{6}$/i;

export interface NicknameStylePayload {
  weight: number | null;
  letterSpacingEm: number | null;
  gradientStops: number[] | null;
  animationId: string | null;
}

/**
 * The font, colour and treatment of a display name.
 *
 * Three axes and no lists. Which faces, colours and treatments exist is whatever rows `option.font`,
 * `option.swatch` and `option.text-effect` have — so one catalogue row here offers every combination
 * of them, and adding a face or a colour is done from the admin console rather than by shipping a
 * client. That is the whole difference between this and a picker of pre-baked styles.
 */
export default defineCosmeticKind<NicknameStylePayload>({
  key: "nickname.style",
  surfaces: ["profileCard", "nicknameInMessages", "memberListRow"],
  primitive: "textStyle",
  layer: 400,
  scope: "both",
  labelKey: "cosmetic_kind_nickname_style",

  // No rows: everything anybody sees comes from the axes below and the wearer's own colours.
  bare: true,

  facets: [
    { id: "font", labelKey: "cosmetic_facet_font", optionKindKey: "option.font" },
    { id: "effect", labelKey: "cosmetic_facet_effect", optionKindKey: "option.text-effect" },
    { id: "color", labelKey: "cosmetic_facet_color", optionKindKey: "option.swatch" },
  ],

  tuning: {
    empty: () => ({ stops: null, angle: null, shape: null, animate: null }),

    isEmpty: (value: NicknameStyleTuning) => value.stops === null || value.stops.length === 0,

    parse(raw) {
      if (typeof raw !== "object" || raw === null) return null;

      const value = raw as Partial<NicknameStyleTuning>;
      const stops = Array.isArray(value.stops)
        ? value.stops.filter(stop => typeof stop === "string" && HEX.test(stop))
        : null;

      const shape = value.shape;

      return {
        stops: stops !== null && stops.length > 0 ? stops.slice(0, 8) : null,
        angle: typeof value.angle === "number" ? Math.min(360, Math.max(0, Math.round(value.angle))) : null,
        shape: shape === "linear" || shape === "radial" || shape === "conic" ? shape : null,
        animate: typeof value.animate === "boolean" ? value.animate : null,
      };
    },

    editor: defineAsyncComponent(() => import("@/cosmetics/tuning/NicknameTuning.vue")),
  },

  parsePayload(raw) {
    if (typeof raw !== "object" || raw === null) return null;

    const value = raw as Partial<NicknameStylePayload>;
    const stops = Array.isArray(value.gradientStops) ? value.gradientStops.filter(stop => typeof stop === "number") : null;

    if (stops !== null && (stops.length === 1 || stops.length > 8)) return null;

    return {
      weight: typeof value.weight === "number" ? value.weight : null,
      letterSpacingEm: typeof value.letterSpacingEm === "number" ? value.letterSpacingEm : null,
      gradientStops: stops !== null && stops.length > 0 ? stops : null,
      animationId: typeof value.animationId === "string" ? value.animationId : null,
    };
  },
});
