import type { ExpressionItem } from "@argon/glue";
import type { ExpressionMedia } from "@/lib/expressions/types";
import { toMedia } from "@/store/data/expressionsStore";

const cache = new WeakMap<ExpressionItem, ExpressionMedia>();

/**
 * One media object per item: a section that re-renders then hands its cells the same props, so none
 * of them re-renders (or decodes its outline again).
 */
export function pickerMedia(item: ExpressionItem): ExpressionMedia {
  let media = cache.get(item);
  if (!media) cache.set(item, (media = toMedia(item)));
  return media;
}
