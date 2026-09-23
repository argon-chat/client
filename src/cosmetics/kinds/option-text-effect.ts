import { logger } from "@argon/core";
import type { TextEffectModule } from "@/cosmetics/textEffect";

/**
 * One treatment a display name may be drawn with.
 *
 * Nobody wears a treatment on its own; it is chosen on another kind's axis.
 *
 * <b>The half of this that is code lives in `effects/`, one file per slug.</b> The other half is
 * an ordinary catalogue row, so a treatment is priced, owned, published and switched off exactly
 * like anything else — and a row whose slug has no file here is left out of the picker rather than
 * offered and then rendering as nothing.
 *
 * A treatment carries nothing in its payload: what it does is the file named after its slug.
 */
export type TextEffectOptionPayload = Record<string, never>;

/**
 * An empty object, and nothing else.
 *
 * The server refuses a member the payload type does not declare, and this one declares none — so
 * an array, or an object carrying anything, is a row this build and the server disagree about.
 */
export function parseTextEffectOptionPayload(raw: unknown): TextEffectOptionPayload | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

  return Object.keys(raw).length === 0 ? {} : null;
}

const effectModules = import.meta.glob("../effects/*.ts", {
  eager: true,
  import: "default",
}) as Record<string, TextEffectModule>;

const bySlug = new Map<string, TextEffectModule>();

for (const [path, module] of Object.entries(effectModules)) {
  if (!module?.slug) {
    logger.error("A text effect file exports no slug", path);
    continue;
  }

  if (bySlug.has(module.slug)) {
    logger.error("Two text effects claim the same slug", module.slug, path);
    continue;
  }

  bySlug.set(module.slug, module);
}

/** The code for a treatment, or undefined when this build has no file for that row. */
export function textEffect(slug: string): TextEffectModule | undefined {
  return bySlug.get(slug);
}

export function textEffects(): readonly TextEffectModule[] {
  return [...bySlug.values()];
}
