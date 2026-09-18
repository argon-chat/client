import { logger } from "@argon/core";
import { watchEffect, type Ref } from "vue";
import { cdnUrl } from "@/store/system/fileStorage";
import { textEffects } from "@/cosmetics/kinds/option-text-effect";
import type { FontOptionPayload } from "@/cosmetics/kinds/option-font";
import type { ResolvedOption } from "@/cosmetics/types";

let keyframesInstalled = false;

/**
 * Puts every treatment's keyframes on the page, once.
 *
 * They cannot live in a scoped component style, because the component does not know what treatments
 * exist — that is the point. Collecting them here keeps a treatment's motion in the same file as the
 * treatment, so removing the file removes the animation with it.
 */
export function installTextEffectKeyframes(): void {
  if (keyframesInstalled || typeof document === "undefined") return;

  keyframesInstalled = true;

  const frames: string[] = [];

  for (const effect of textEffects()) {
    if (effect.keyframes) frames.push(effect.keyframes);
  }

  if (frames.length === 0) return;

  const style = document.createElement("style");

  style.dataset.cosmeticEffects = "";
  style.textContent = frames.join("\n");
  document.head.append(style);
}

const registeredFaces = new Set<string>();

/**
 * Registers an uploaded typeface with the document so a rule may name it.
 *
 * <b>Only ever from a file this product serves.</b> The family name is asked for by a rule, and it
 * resolves to whatever is registered under it — so a face nobody registered would fall through to
 * whatever the viewer happens to have installed locally, which is how an unlicensed typeface ends up
 * on screen without anything having shipped it. A row carrying no file is a face already in the
 * bundle and needs nothing done.
 *
 * Registration is per document and permanent, which is why it is counted once: the same face is on
 * screen for every member of a space wearing it, and adding it per name would be thousands of
 * identical FontFace objects.
 */
export function useFontOption(option: Ref<ResolvedOption | undefined>): void {
  watchEffect(() => {
    const chosen = option.value;

    if (!chosen || typeof document === "undefined") return;

    const family = (chosen.payload as FontOptionPayload | undefined)?.cssFamily;
    const fileId = chosen.assets.Primary;

    if (!family || !fileId || registeredFaces.has(fileId)) return;

    registeredFaces.add(fileId);

    // The family is quoted out of the payload's own string: what a rule names has to be the family
    // this row declares, and nothing else the string might have been made to say.
    const face = new FontFace(family.split(",")[0].trim().replaceAll(/["']/g, ""), `url(${cdnUrl(fileId)})`);

    face.load()
      .then(loaded => document.fonts.add(loaded))
      .catch(error => logger.warn("A cosmetic typeface could not be loaded", chosen.slug, error));
  });
}
