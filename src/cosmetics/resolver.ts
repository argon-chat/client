import type {
  CatalogueCosmetic,
  IWornCosmetic,
  WornNickname,
} from "@argon/glue";
import { logger } from "@argon/core";

import type {
  CosmeticFacet,
  CosmeticKindModule,
  CosmeticSurface,
  ResolvedCosmetic,
  ResolvedOption,
} from "@/cosmetics/types";
import {
  assetsOf,
  nicknameAxesOf,
  tuningOf,
} from "@/cosmetics/wire";
import {
  asWornItem,
  asWornNickname,
} from "@/cosmetics/wornEntry";
import {
  isNicknameStyleTuningEmpty,
  NICKNAME_STYLE_KIND,
} from "@/cosmetics/kinds/nickname-style";
import { resolveKind } from "@/cosmetics/registry";

export type RenderFailure =
  | "missing_row"
  | "unknown_kind"
  | "unknown_entry"
  | "unimplemented_slug"
  | "payload_rejected"
  | "option_rejected";

export interface ResolverContext {
  /** The catalogue, keyed by `cosmeticIdKey`. */
  readonly items: ReadonlyMap<string, CatalogueCosmetic>;
  readonly enabledKinds: ReadonlySet<string>;
  report(kindKey: string, reason: RenderFailure, subject: string): void;
}

export interface CosmeticResolver {
  item(cosmeticId: string | null | undefined): CatalogueCosmetic | null;
  resolveRow(item: CatalogueCosmetic): ResolvedCosmetic | null;
  resolveWorn(worn: readonly IWornCosmetic[], surface: CosmeticSurface): ResolvedCosmetic[];
  kindKeyOf(worn: IWornCosmetic): string | null;
}

/** Guids reach the client as text from more than one service; which of them capitalises is not ours to rely on. */
export function cosmeticIdKey(cosmeticId: string): string {
  return String(cosmeticId).toLowerCase();
}

/**
 * Turns worn entries into drawable cosmetics against one catalogue.
 *
 * Synchronous and memoised per row and per worn nickname: a member list asks for thousands of rows
 * while it renders. A new catalogue means a new resolver, which is what drops the memo.
 */
export function createCosmeticResolver(context: ResolverContext): CosmeticResolver {
  const resolvedRows = new WeakMap<CatalogueCosmetic, ResolvedCosmetic | null>();
  const resolvedNicknames = new WeakMap<WornNickname, ResolvedCosmetic | null>();

  function item(cosmeticId: string | null | undefined): CatalogueCosmetic | null {
    if (!cosmeticId) {
      return null;
    }

    return context.items.get(cosmeticIdKey(cosmeticId)) ?? null;
  }

  function parseRow(kind: CosmeticKindModule, row: CatalogueCosmetic): unknown {
    try {
      return kind.parsePayload(row.payload);
    } catch (error) {
      logger.warn("A cosmetic payload could not be read", row.slug, error);

      return null;
    }
  }

  function readRow(row: CatalogueCosmetic): ResolvedCosmetic | null {
    const kind = resolveKind(row.kindKey);

    if (kind === undefined) {
      context.report(row.kindKey, "unknown_kind", cosmeticIdKey(row.cosmeticId));

      return null;
    }

    // A slug the server already ships and this build has no module for is not a malformed payload,
    // and is told apart on the dashboard so the search starts at the client.
    if (kind.implementsSlug && !kind.implementsSlug(row.slug)) {
      context.report(kind.key, "unimplemented_slug", cosmeticIdKey(row.cosmeticId));

      return null;
    }

    const payload = parseRow(kind, row);

    if (payload === null) {
      context.report(kind.key, "payload_rejected", cosmeticIdKey(row.cosmeticId));

      return null;
    }

    return {
      itemId: row.cosmeticId,
      slug: row.slug,
      kind,
      layer: kind.layer,
      payload,
      assets: assetsOf(row.assets),
      options: [],
    };
  }

  function resolveRow(row: CatalogueCosmetic): ResolvedCosmetic | null {
    const memoised = resolvedRows.get(row);

    if (memoised !== undefined) {
      return memoised;
    }

    const resolved = readRow(row);

    resolvedRows.set(row, resolved);

    return resolved;
  }

  function resolveOption(facet: CosmeticFacet, optionId: string | null): ResolvedOption | null {
    if (optionId === null) {
      return null;
    }

    const row = item(optionId);

    if (row === null) {
      context.report(facet.optionKindKey, "missing_row", cosmeticIdKey(optionId));

      return null;
    }

    if (row.kindKey !== facet.optionKindKey) {
      context.report(facet.optionKindKey, "option_rejected", cosmeticIdKey(optionId));

      return null;
    }

    if (!context.enabledKinds.has(row.kindKey)) {
      return null;
    }

    const resolved = resolveRow(row);

    if (resolved === null) {
      return null;
    }

    return {
      facetId: facet.id,
      kindKey: row.kindKey,
      itemId: row.cosmeticId,
      slug: row.slug,
      payload: resolved.payload,
      assets: resolved.assets,
    };
  }

  function composeNickname(worn: WornNickname): ResolvedCosmetic | null {
    const kind = resolveKind(NICKNAME_STYLE_KIND);

    if (kind === undefined || !context.enabledKinds.has(kind.key)) {
      return null;
    }

    const tuning = tuningOf(worn);

    if (tuning === null) {
      context.report(kind.key, "payload_rejected", "tuning");

      return null;
    }

    const axes = nicknameAxesOf(worn);
    const options: ResolvedOption[] = [];

    for (const facet of kind.facets ?? []) {
      const option = resolveOption(facet, axes[facet.id]);

      if (option !== null) {
        options.push(option);
      }
    }

    if (options.length === 0 && isNicknameStyleTuningEmpty(tuning)) {
      return null;
    }

    return {
      itemId: null,
      slug: null,
      kind,
      layer: kind.layer,
      payload: tuning,
      assets: {},
      options,
    };
  }

  function resolveNickname(worn: WornNickname): ResolvedCosmetic | null {
    const memoised = resolvedNicknames.get(worn);

    if (memoised !== undefined) {
      return memoised;
    }

    const resolved = composeNickname(worn);

    resolvedNicknames.set(worn, resolved);

    return resolved;
  }

  function resolveWornItem(itemId: string, surface: CosmeticSurface): ResolvedCosmetic | null {
    const row = item(itemId);

    if (row === null) {
      context.report("unknown", "missing_row", cosmeticIdKey(itemId));

      return null;
    }

    const kind = resolveKind(row.kindKey);

    if (kind === undefined) {
      context.report(row.kindKey, "unknown_kind", cosmeticIdKey(itemId));

      return null;
    }

    if (!kind.surfaces.includes(surface) || !context.enabledKinds.has(kind.key)) {
      return null;
    }

    return resolveRow(row);
  }

  function resolveEntry(worn: unknown, surface: CosmeticSurface): ResolvedCosmetic | null {
    const wornItem = asWornItem(worn);

    if (wornItem !== null) {
      return resolveWornItem(wornItem.itemId, surface);
    }

    const nickname = asWornNickname(worn);

    if (nickname === null) {
      context.report("unknown", "unknown_entry", "entry");

      return null;
    }

    const resolved = resolveNickname(nickname);

    if (resolved === null || !resolved.kind.surfaces.includes(surface)) {
      return null;
    }

    return resolved;
  }

  function resolveWorn(worn: readonly IWornCosmetic[], surface: CosmeticSurface): ResolvedCosmetic[] {
    const resolved: ResolvedCosmetic[] = [];

    for (const entry of worn) {
      const cosmetic = resolveEntry(entry, surface);

      if (cosmetic !== null) {
        resolved.push(cosmetic);
      }
    }

    return resolved.sort((left, right) => left.layer - right.layer);
  }

  /** A worn item's kind comes from its catalogue row; null when the row is unknown here. */
  function kindKeyOf(worn: IWornCosmetic): string | null {
    if (asWornNickname(worn) !== null) {
      return NICKNAME_STYLE_KIND;
    }

    const wornItem = asWornItem(worn);

    if (wornItem === null) {
      return null;
    }

    return item(wornItem.itemId)?.kindKey ?? null;
  }

  return {
    item,
    resolveRow,
    resolveWorn,
    kindKeyOf,
  };
}
