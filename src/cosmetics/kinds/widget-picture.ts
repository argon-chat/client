import { defineAsyncComponent } from "vue";
import { defineCosmeticKind } from "@/cosmetics/types";

/** The card carries nothing an operator authored: the picture is its wearer's. */
export type PictureWidgetPayload = Record<string, never>;

export interface PictureContent {
  fileId: string | null;
  caption: string | null;
  fit: "cover" | "contain" | null;

  /**
   * Whether the file moves.
   *
   * Recorded rather than sniffed, because the card has to know which element to mount before the
   * file is fetched — an <img> pointed at a video shows nothing and reports no error.
   */
  kind: "image" | "video" | null;
}

/**
 * How large a card's media may be.
 *
 * <b>It is downloaded by everyone who opens the profile.</b> A still is generous at this size and an
 * animation has to be a short loop rather than a clip, which is the right shape for a card anyway.
 * The server enforces the same number; this one is so nobody watches a long upload fail at the end.
 */
export const MEDIA_BYTE_LIMIT = 8 * 1024 * 1024;

/** GIF is accepted and arrives as one: the browser plays it in an <img> like any other picture. */
export const MEDIA_MIME = "image/png,image/jpeg,image/gif,image/webp,video/webm,video/mp4";

const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A picture card.
 *
 * <b>The first card that is not words.</b> A note and a row of tags are both text, so a board of
 * them says nothing about how a card of any other shape sits on a profile — how it crops, what it
 * does to the rhythm of the grid, whether a tall one looks deliberate or stranded.
 *
 * A file id, never an address. A card holding a URL would fire an image request from every profile
 * it appears on, at whatever host its owner chose, which is a way of collecting the address of
 * everybody who looked at you.
 */
export default defineCosmeticKind<PictureWidgetPayload>({
  key: "widget.picture",
  surfaces: ["profileCard", "ownProfile"],
  primitive: "widgetSlot",
  layer: 520,
  maxSlots: 4,
  scope: "both",
  labelKey: "cosmetic_kind_widget_picture",

  board: {
    minWidth: 2,
    maxWidth: 4,
    minHeight: 4,
    maxHeight: 10,

    empty: () => ({ fileId: null, caption: null, fit: null, kind: null }),

    parse(raw) {
      if (typeof raw !== "object" || raw === null) return null;

      const value = raw as Partial<PictureContent>;

      return {
        fileId: typeof value.fileId === "string" && FILE_ID.test(value.fileId) ? value.fileId : null,
        caption: typeof value.caption === "string" ? value.caption : null,
        fit: value.fit === "cover" || value.fit === "contain" ? value.fit : null,
        kind: value.kind === "image" || value.kind === "video" ? value.kind : null,
      };
    },

    preview: defineAsyncComponent(() => import("@/cosmetics/widgets/previews/PicturePreview.vue")),

    card: defineAsyncComponent(() => import("@/cosmetics/widgets/PictureCard.vue")),
    editor: defineAsyncComponent(() => import("@/cosmetics/widgets/PictureEditor.vue")),
  },

  parsePayload(raw) {
    return typeof raw === "object" && raw !== null ? {} : null;
  },
});
