import { defineAsyncComponent } from "vue";
import { defineCosmeticKind } from "@/cosmetics/types";

/** The card itself carries nothing: what it says is what its wearer wrote. */
export type NoteWidgetPayload = Record<string, never>;

export interface NoteContent {
  heading: string | null;
  body: string | null;
}

/**
 * A card of the wearer's own words.
 *
 * <b>The plainest widget there can be, and here to prove the mechanism.</b> A heading and some text:
 * no entity to look up, nothing outside itself. A widget worth having — a favourite game, a shelf of
 * them, statistics — is this same shape with a richer content type and something real behind it, and
 * the board it lands on needs no changes to hold it.
 */
export default defineCosmeticKind<NoteWidgetPayload>({
  key: "widget.note",
  surfaces: ["profileCard", "ownProfile"],
  primitive: "widgetSlot",
  layer: 500,
  maxSlots: 4,
  scope: "both",
  labelKey: "cosmetic_kind_widget_note",

  board: {
    minWidth: 2,
    maxWidth: 4,
    minHeight: 5,
    maxHeight: 12,

    empty: () => ({ heading: null, body: null }),

    parse(raw) {
      if (typeof raw !== "object" || raw === null) return null;

      const value = raw as Partial<NoteContent>;

      return {
        heading: typeof value.heading === "string" ? value.heading : null,
        body: typeof value.body === "string" ? value.body : null,
      };
    },

    preview: defineAsyncComponent(() => import("@/cosmetics/widgets/previews/NotePreview.vue")),

    card: defineAsyncComponent(() => import("@/cosmetics/widgets/NoteCard.vue")),
    editor: defineAsyncComponent(() => import("@/cosmetics/widgets/NoteEditor.vue")),
  },

  parsePayload(raw) {
    return typeof raw === "object" && raw !== null ? {} : null;
  },
});
