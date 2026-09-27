import { hasInjectionContext, inject, provide, type InjectionKey } from "vue";
import type { ExpressionItem } from "@argon/glue";
import { useExpressionsStore } from "@/store/data/expressionsStore";

/**
 * How the composer and message rendering find custom emoji and stickers, without depending on the
 * store: tests and detached views provide their own, the app root provides the store-backed one.
 */
export interface ExpressionResolver {
  /** Case-insensitive, colons optional; `spaceId` null looks through every loaded space. */
  emojiByName(spaceId: string | null, name: string): ExpressionItem | null;
  /** Any loaded space. */
  itemById(itemId: string): ExpressionItem | null;
  /** For `:name` completion; `spaceId` null means every loaded space. */
  emojiCandidates(spaceId: string | null, prefix: string, limit: number): ExpressionItem[];
  /** Load (or revalidate) a space's set in the background; safe to call from a render. */
  ensureLoaded(spaceId: string): void;
}

export const EXPRESSION_RESOLVER: InjectionKey<ExpressionResolver> = Symbol("ExpressionResolver");

/** Knows no custom expressions: what a view outside the app root gets. */
export const noopResolver: ExpressionResolver = {
  emojiByName: () => null,
  itemById: () => null,
  emojiCandidates: () => [],
  ensureLoaded: () => {},
};

export function provideExpressionResolver(resolver: ExpressionResolver): void {
  provide(EXPRESSION_RESOLVER, resolver);
}

export function useExpressionResolver(): ExpressionResolver {
  return hasInjectionContext() ? inject(EXPRESSION_RESOLVER, noopResolver) : noopResolver;
}

/** Backed by `useExpressionsStore`, resolved per call so it works with whichever Pinia is active. */
export function createStoreResolver(): ExpressionResolver {
  return {
    emojiByName: (spaceId, name) => useExpressionsStore().emojiByName(spaceId, name),
    itemById: (itemId) => useExpressionsStore().itemById(itemId),
    emojiCandidates: (spaceId, prefix, limit) => useExpressionsStore().emojiCandidates(spaceId, prefix, limit),
    ensureLoaded: (spaceId) => {
      if (spaceId) void useExpressionsStore().ensureLoaded(spaceId);
    },
  };
}
