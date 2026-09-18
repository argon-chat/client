import { defineAsyncComponent } from "vue";
import { defineCosmeticKind } from "@/cosmetics/types";

export type TagsWidgetPayload = Record<string, never>;

export interface TagsContent {
  heading: string | null;
  tags: string[];
}

export const TAG_LIMIT = 12;

export const TAG_MAX_LENGTH = 24;

/**
 * A card of short labels the wearer chose for themselves.
 *
 * The second of the two cards that exist to exercise the mechanism, and the more useful of the pair
 * to have written: its content is a <i>list</i>, which is the shape most real widgets have — a shelf
 * of games, a set of interests — so it is what proves the board can hold something that grows.
 */
export default defineCosmeticKind<TagsWidgetPayload>({
  key: "widget.tags",
  surfaces: ["profileCard", "ownProfile"],
  primitive: "widgetSlot",
  layer: 501,
  maxSlots: 4,
  scope: "both",
  labelKey: "cosmetic_kind_widget_tags",

  board: {
    minWidth: 2,
    maxWidth: 4,
    minHeight: 4,
    maxHeight: 12,

    empty: () => ({ heading: null, tags: [] }),

    parse(raw) {
      if (typeof raw !== "object" || raw === null) return null;

      const value = raw as Partial<TagsContent>;
      const tags = Array.isArray(value.tags)
        ? value.tags.filter(tag => typeof tag === "string" && tag.length > 0 && tag.length <= TAG_MAX_LENGTH)
        : [];

      return {
        heading: typeof value.heading === "string" ? value.heading : null,
        tags: tags.slice(0, TAG_LIMIT),
      };
    },

    preview: defineAsyncComponent(() => import("@/cosmetics/widgets/previews/TagsPreview.vue")),

    card: defineAsyncComponent(() => import("@/cosmetics/widgets/TagsCard.vue")),
    editor: defineAsyncComponent(() => import("@/cosmetics/widgets/TagsEditor.vue")),
  },

  parsePayload(raw) {
    return typeof raw === "object" && raw !== null ? {} : null;
  },
});
