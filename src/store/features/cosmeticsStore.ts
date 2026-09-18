import { logger } from "@argon/core";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  ArgonUserProfile,
  CosmeticCatalogue,
  CosmeticLoadoutList,
  CatalogueCosmetic,
  EquippedCosmetic,
  EquippedCosmeticOption,
  ILoadoutActionResult,
  WidgetCard,
} from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import {
  assetsOf,
  type CosmeticKindModule,
  type CosmeticSurface,
  type ResolvedCosmetic,
  type ResolvedOption,
} from "@/cosmetics/types";
import { resolveKind } from "@/cosmetics/registry";
import { metrics } from "@/lib/telemetry/metrics";

/**
 * Profile cosmetics: turning what the server says somebody is wearing into something renderable,
 * and the calls that change it.
 *
 * `resolve` is deliberately synchronous and pure. The expensive caller is a member list — thousands
 * of rows, each needing an answer while it renders — and anything that made that an await, or a
 * per-row reactive subscription, would be the thing that makes a big space slow. It is also what
 * lets the whole thing be tested without mounting a component.
 */
export const useCosmeticsStore = defineStore("cosmetics", () => {
  const api = useApi();
  const flags = useFeatureFlags();

  const catalogue = ref<CosmeticCatalogue | null>(null);
  const loadouts = ref<CosmeticLoadoutList | null>(null);

  /**
   * The look currently being edited, and therefore the one every preview on the page should show.
   *
   * Kept here rather than in the panel because the profile card at the top of the settings is a
   * different component that has to follow it: a preview of some other look than the one being
   * changed is a preview of nothing anybody asked to see.
   */
  const editing = ref<string | null>(null);

  const editingLoadout = computed(() =>
    loadouts.value?.loadouts.find(loadout => loadout.loadoutId === editing.value) ?? null);

  /**
   * What other people are wearing, per scope, already parsed.
   *
   * This exists for the two surfaces that cannot ask per person: a message author's name and a
   * member list row. Both render while they render — there is nowhere to await — and both can be on
   * screen thousands of times, so the answer has to be in memory before the row asks for it.
   *
   * Parsed once on the way in rather than on every read: a row is re-rendered constantly and
   * re-parsing a payload per frame is the kind of cost that only shows up on somebody else's laptop.
   */
  const worn = ref<Record<string, Record<string, ResolvedCosmetic[]>>>({});

  /**
   * Who people are in each scope, when a look says somebody else.
   *
   * Fetched by the same batch as what they are wearing, because it is the same question with the
   * same scope: a member row asking "what is this person wearing here" is also asking "what are they
   * called here", and two calls for one answer is one call too many on the busiest list we have.
   */
  const identities = ref<Record<string, Record<string, { name: string | null; avatar: string | null }>>>({});

  const inflight = new Map<string, Promise<void>>();

  const GLOBAL_SCOPE = "@global";

  function scopeKey(spaceId: string | null | undefined): string {
    return spaceId ?? GLOBAL_SCOPE;
  }

  onSessionReset(() => {
    catalogue.value = null;
    loadouts.value = null;
    editing.value = null;
    worn.value = {};
    identities.value = {};
    inflight.clear();
    catalogueInflight = null;
  });

  /**
   * Whether a kind is switched on for this account.
   *
   * Absent means on — the same rule the server applies. A kind exists because this build declares
   * it; requiring somebody to also create a flag row before shipped code does anything is how a
   * feature ends up live, correct and invisible.
   */
  function isKindEnabled(kindKey: string): boolean {
    return flags.isCosmeticKindEnabled(kindKey);
  }

  function parse(equipped: EquippedCosmetic): ResolvedCosmetic | null {
    const kind = resolveKind(equipped.kindKey);

    // A kind this build does not have. Expected rather than exceptional: the server may be ahead of
    // this client, or the kind's file may have been removed on purpose.
    if (!kind) return null;

    if (!isKindEnabled(kind.key)) return null;

    let raw: unknown;

    try {
      raw = JSON.parse(equipped.payloadJson);
    } catch {
      metrics.count("cosmetic.render.failed", { kind: kind.key, reason: "malformed_json" });
      return null;
    }

    const payload = kind.parsePayload(raw);

    if (payload === null) {
      metrics.count("cosmetic.render.failed", { kind: kind.key, reason: "payload_rejected" });
      return null;
    }

    return {
      itemId: equipped.itemId,
      slug: equipped.slug,
      kind,
      layer: equipped.layer,
      slotIndex: equipped.slotIndex,
      payload,
      assets: assetsOf(equipped),
      options: compose(equipped.options ?? []),
      content: readContent(kind, equipped.contentJson ?? null),
      cell: {
        x: equipped.boardX ?? 0,
        y: equipped.boardY ?? 0,
        w: equipped.boardW ?? 1,
        h: equipped.boardH ?? 1,
      },
      version: equipped.version ?? null,
    };
  }

  /**
   * What the wearer wrote into a card, read through the kind's own schema.
   *
   * A card whose content this build cannot read falls back to empty rather than to nothing: the card
   * itself is still worn, and drawing an empty one is closer to the truth than dropping it.
   */
  function readContent(kind: CosmeticKindModule, contentJson: string | null): unknown {
    // A card's content and a thing's tuning are the same field said two ways: one is what somebody
    // wrote into a frame, the other is what they decided about something they wear.
    const schema = kind.board ?? kind.tuning;

    if (!schema) return null;

    if (!contentJson) return schema.empty();

    try {
      return schema.parse(JSON.parse(contentJson)) ?? schema.empty();
    } catch {
      metrics.count("cosmetic.render.failed", { kind: kind.key, reason: "malformed_json" });
      return schema.empty();
    }
  }

  /**
   * Who somebody is in the spaces a look applies to.
   *
   * Every field travels on every call, and null means the account's own value shows through — so
   * clearing an override and never setting one are the same thing said the same way.
   */
  async function setLoadoutIdentity(
    loadoutId: string,
    displayName: string | null,
    bio: string | null,
    keepAvatar: boolean,
  ): Promise<boolean> {
    return await settle(
      await api.cosmeticsInteraction.SetLoadoutIdentity({ loadoutId, displayName, bio, keepAvatar } as never),
      "set the look's identity",
    );
  }

  /**
   * Replaces a look's whole board: which cards, in what order, how wide, and what each says.
   *
   * One call rather than a card at a time, because reordering is every position changing at once —
   * done as a sequence of edits, every intermediate board is one somebody could be reading.
   */
  async function setWidgetBoard(loadoutId: string, cards: readonly WidgetCard[]): Promise<boolean> {
    return await settle(
      await api.cosmeticsInteraction.SetWidgetBoard(loadoutId, cards as WidgetCard[]),
      "set the widget board",
    );
  }

  /**
   * The options the wearer composed this item from, each resolved through its own kind.
   *
   * An option whose kind this build does not ship, or whose payload does not parse, is dropped
   * rather than rendered as nothing — the name then draws without that axis, which is the same way
   * every other unknown thing degrades here.
   */
  function compose(options: readonly EquippedCosmeticOption[]): ResolvedOption[] {
    const composed: ResolvedOption[] = [];

    for (const option of options) {
      const kind = resolveKind(option.kindKey);

      if (!kind || !isKindEnabled(kind.key)) continue;

      let raw: unknown;

      try {
        raw = JSON.parse(option.payloadJson);
      } catch {
        metrics.count("cosmetic.render.failed", { kind: kind.key, reason: "malformed_json" });
        continue;
      }

      const payload = kind.parsePayload(raw);

      if (payload === null) {
        metrics.count("cosmetic.render.failed", { kind: kind.key, reason: "payload_rejected" });
        continue;
      }

      composed.push({
        facetId: option.facetId,
        kindKey: option.kindKey,
        itemId: option.itemId,
        slug: option.slug,
        payload,
        assets: assetsOf(option),
        version: option.version ?? null,
      });
    }

    return composed;
  }

  /**
   * A catalogue row, resolved the same way a worn one is — so a picker can draw a real preview with
   * the same renderer that draws the real thing, rather than a second, drifting approximation of it.
   */
  function resolveCatalogueItem(item: CatalogueCosmetic): ResolvedCosmetic | null {
    return parse({
      kindKey: item.kindKey,
      itemId: item.cosmeticId,
      slug: item.slug,
      layer: 0,
      slotIndex: 0,
      payloadJson: item.payloadJson,
      assets: item.assets,
      options: null,
      contentJson: null,
      boardX: 0,
      boardY: 0,
      boardW: 1,
      boardH: 1,
    } as unknown as EquippedCosmetic);
  }

  /**
   * The catalogue, by cosmetic id, so a caller holding only an id can ask about it.
   *
   * Indexed rather than searched because the caller with an id and no row is the inventory: a
   * screenful of items each asking about its own key would otherwise walk the whole catalogue once
   * per item, per render. Ids are compared lowercased — a guid reaches this client as text from two
   * different services, and which of them capitalises it is not something to depend on.
   */
  const catalogueById = computed(() => {
    const index = new Map<string, CatalogueCosmetic>();

    for (const item of catalogue.value?.items ?? []) {
      index.set(String(item.cosmeticId).toLowerCase(), item);
    }

    return index;
  });

  /**
   * One catalogue row by its id, or null when there is no such row here.
   *
   * Null is an ordinary answer rather than a fault: the catalogue may not have been read yet, and a
   * row can be unpublished or deleted after something pointing at it was handed out. Every caller
   * has to be able to draw without it.
   */
  function catalogueItemById(cosmeticId: string | null | undefined): CatalogueCosmetic | null {
    if (!cosmeticId) return null;

    return catalogueById.value.get(String(cosmeticId).toLowerCase()) ?? null;
  }

  /** One option's payload, parsed through its own kind. Null when this build cannot read it. */
  function parseOptionPayload(option: EquippedCosmeticOption): unknown {
    const kind = resolveKind(option.kindKey);

    if (!kind) return null;

    try {
      return kind.parsePayload(JSON.parse(option.payloadJson));
    } catch {
      return null;
    }
  }

  /**
   * Everything an axis offers: the catalogue rows of the kind it draws its options from.
   *
   * Owned first, then by name, so what can actually be used is not buried under what cannot.
   */
  function optionsForFacet(optionKindKey: string): CatalogueCosmetic[] {
    return (catalogue.value?.items ?? [])
      .filter(item => item.kindKey === optionKindKey)
      .sort((left, right) => Number(right.owned) - Number(left.owned));
  }

  /**
   * What this profile is wearing on one surface, in compositing order.
   */
  function resolve(profile: ArgonUserProfile | null | undefined, surface: CosmeticSurface): ResolvedCosmetic[] {
    const equipped = profile?.cosmetics;

    if (!equipped || equipped.length === 0) return [];

    const resolved: ResolvedCosmetic[] = [];

    for (const item of equipped) {
      const parsed = parse(item);

      if (parsed && parsed.kind.surfaces.includes(surface)) resolved.push(parsed);
    }

    resolved.sort((left, right) => left.layer - right.layer || left.slotIndex - right.slotIndex);

    return resolved;
  }

  /**
   * What one person is wearing on one surface, answered from memory or not at all.
   *
   * Deliberately has no fetch in it. A row that triggered a request when it could not answer would
   * make scrolling a member list a request storm; `prefetchWorn` is how the answers get here, and
   * anything not yet fetched simply renders plain until they arrive.
   */
  function wornBy(
    spaceId: string | null | undefined,
    userId: string,
    surface: CosmeticSurface,
  ): ResolvedCosmetic[] {
    const held = worn.value[scopeKey(spaceId)]?.[userId];

    if (!held || held.length === 0) return [];

    return held.filter(item => item.kind.surfaces.includes(surface));
  }

  /**
   * Fills the answers for a group of people, skipping whoever is already known or in flight.
   */
  async function prefetchWorn(spaceId: string | null | undefined, userIds: readonly string[]): Promise<void> {
    const scope = scopeKey(spaceId);
    const known = worn.value[scope] ?? {};

    const missing = [...new Set(userIds)].filter(id => !(id in known) && !inflight.has(`${scope}:${id}`));

    if (missing.length === 0) return;

    const pending = (async () => {
      try {
        const answers = await api.cosmeticsInteraction.GetWornBy(spaceId ?? null, missing);

        const filled: Record<string, ResolvedCosmetic[]> = { ...(worn.value[scope] ?? {}) };
        const named: Record<string, { name: string | null; avatar: string | null }> = { ...(identities.value[scope] ?? {}) };

        // Everybody asked about is recorded, including the many who wear nothing — otherwise every
        // pass would ask about them again, which is the whole roster on every scroll.
        for (const id of missing) {
          filled[id] = [];
          named[id] = { name: null, avatar: null };
        }

        for (const answer of answers) {
          const resolved: ResolvedCosmetic[] = [];

          for (const item of answer.cosmetics) {
            const parsed = parse(item);

            if (parsed) resolved.push(parsed);
          }

          resolved.sort((left, right) => left.layer - right.layer || left.slotIndex - right.slotIndex);
          filled[answer.userId] = resolved;
          named[answer.userId] = {
            name: answer.displayNameOverride ?? null,
            avatar: answer.avatarFileIdOverride ?? null,
          };
        }

        worn.value = { ...worn.value, [scope]: filled };
        identities.value = { ...identities.value, [scope]: named };
      } catch (error) {
        logger.warn("Could not read what a group of people are wearing", error);
      } finally {
        for (const id of missing) inflight.delete(`${scope}:${id}`);
      }
    })();

    for (const id of missing) inflight.set(`${scope}:${id}`, pending);

    await pending;
  }

  /**
   * Who somebody is in a scope, answered from memory or not at all.
   *
   * Null means "as in their account", which is both what most people are and what everybody is
   * before the batch lands — so a row drawing a name never waits on this.
   */
  function wornIdentity(
    spaceId: string | null | undefined,
    userId: string,
  ): { name: string | null; avatar: string | null } {
    return identities.value[scopeKey(spaceId)]?.[userId] ?? { name: null, avatar: null };
  }

  /**
   * The picture to draw for somebody here: the look's if it has one, otherwise the account's.
   *
   * Synchronous and answered from the same batch a row already asked for — a member list draws
   * thousands of these while it scrolls, and anything that awaited would be a request storm.
   */
  function wornAvatar(
    spaceId: string | null | undefined,
    userId: string,
    accountFileId: string | null | undefined,
  ): string | undefined {
    return wornIdentity(spaceId, userId).avatar ?? accountFileId ?? undefined;
  }

  /** Drops what is remembered, for when a kind is switched or somebody's look changed. */
  function forgetWorn(userId?: string): void {
    if (!userId) {
      worn.value = {};
      identities.value = {};
      return;
    }

    const next: Record<string, Record<string, ResolvedCosmetic[]>> = {};

    for (const [scope, people] of Object.entries(worn.value)) {
      const { [userId]: _dropped, ...rest } = people;
      next[scope] = rest;
    }

    worn.value = next;
  }

  /**
   * Throws out whatever is being held of a cosmetic an operator has re-authored since.
   *
   * <b>The catalogue read is the only moment anybody learns a row moved.</b> Changing a row changes
   * nothing about the people wearing it, so no event goes out for them, and the payload they were
   * fetched with is cached — in memory here for a member list, and on disk for hours for a profile
   * card. Without this the change reaches the people who happen to be looking at the picker and
   * nobody else, for as long as the caches live.
   *
   * Everything is compared by the row's authoring number, so what gets dropped is exactly what is
   * behind. A catalogue read happens every time the picker opens, and dropping the caches wholesale
   * each time would be the same as not having them.
   */
  async function dropStaleAuthorings(fresh: CosmeticCatalogue): Promise<void> {
    const versionOf = new Map<string, number>();

    for (const item of fresh.items) {
      versionOf.set(String(item.cosmeticId).toLowerCase(), item.version);
    }

    for (const people of Object.values(worn.value)) {
      for (const [userId, items] of Object.entries(people)) {
        const behind = items.some(item =>
          isBehind(item.itemId, item.version, versionOf)
          || item.options.some(option => isBehind(option.itemId, option.version, versionOf)));

        if (behind) forgetWorn(userId);
      }
    }

    // Imported here rather than at the top: the profile cache imports this store to forget a person
    // when their profile changes, and a static cycle between the two is a load-order accident
    // waiting for a bundler to reorder them.
    const { useProfileCacheStore } = await import("@/store/data/profileCacheStore");
    const touched = await useProfileCacheStore().invalidateStaleCosmetics(versionOf);

    for (const userId of touched) {
      forgetWorn(userId);
    }
  }

  function isBehind(itemId: string, held: number | null, versionOf: ReadonlyMap<string, number>): boolean {
    // A server that does not send the version leaves nothing to compare against.
    if (held === null) return false;

    const current = versionOf.get(String(itemId).toLowerCase());

    return current !== undefined && current !== held;
  }

  /**
   * The catalogue read in flight, if there is one.
   *
   * Two things want the catalogue on the same screen now — the picker, and the inventory, which
   * needs it before it can say what a key opens. A second `GetCatalogue()` is worse than a wasted
   * round trip: it lands after the first, re-assigns `catalogue`, and re-runs every derivation
   * reading it, repainting exactly what the first read had already settled. So everybody who asks
   * while one is running gets that one, the way `prefetchWorn` shares a batch already in the air.
   */
  let catalogueInflight: Promise<CosmeticCatalogue | null> | null = null;

  function loadCatalogue(): Promise<CosmeticCatalogue | null> {
    if (catalogueInflight) return catalogueInflight;

    catalogueInflight = readCatalogue().finally(() => {
      catalogueInflight = null;
    });

    return catalogueInflight;
  }

  async function readCatalogue(): Promise<CosmeticCatalogue | null> {
    try {
      catalogue.value = await api.cosmeticsInteraction.GetCatalogue();
      await dropStaleAuthorings(catalogue.value);
      metrics.count("cosmetic.catalogue.opened", { result: "ok" });
      return catalogue.value;
    } catch (error) {
      logger.error("Failed to load the cosmetics catalogue", error);
      metrics.count("cosmetic.catalogue.opened", { result: "failed" });
      return null;
    }
  }

  async function loadLoadouts(): Promise<CosmeticLoadoutList | null> {
    try {
      loadouts.value = await api.cosmeticsInteraction.GetMyLoadouts();
      return loadouts.value;
    } catch (error) {
      logger.error("Failed to load cosmetic loadouts", error);
      return null;
    }
  }

  async function createLoadout(name: string): Promise<string | null> {
    const result = await api.cosmeticsInteraction.CreateLoadout(name);

    if (result.isFailedCreateLoadout()) {
      logger.warn("Loadout was refused", result.error);
      return null;
    }

    if (!result.isSuccessCreateLoadout()) return null;

    await loadLoadouts();
    return result.loadoutId;
  }

  /**
   * The loadout actions that all answer the same way: nothing on success, a reason on refusal.
   */
  async function renameLoadout(loadoutId: string, name: string): Promise<boolean> {
    return await settle(await api.cosmeticsInteraction.RenameLoadout(loadoutId, name), "rename");
  }

  async function setDefaultLoadout(loadoutId: string): Promise<boolean> {
    return await settle(await api.cosmeticsInteraction.SetDefaultLoadout(loadoutId), "set default");
  }

  /**
   * The parts of something worn that only its wearer decides, and the only way a bare kind is put on.
   */
  async function configureCosmetic(
    loadoutId: string,
    kindKey: string,
    slotIndex: number,
    overridesJson: string | null,
    contentJson: string | null,
  ): Promise<boolean> {
    const result = await api.cosmeticsInteraction.ConfigureCosmetic(
      loadoutId, kindKey, slotIndex, overridesJson, contentJson);

    if (result.isFailedEquip()) {
      logger.warn("A cosmetic's settings were refused", kindKey, result.error);
      return false;
    }

    return true;
  }

  async function setLoadoutPaused(loadoutId: string, paused: boolean): Promise<boolean> {
    return await settle(await api.cosmeticsInteraction.SetLoadoutPaused(loadoutId, paused), "set paused");
  }

  async function deleteLoadout(loadoutId: string): Promise<boolean> {
    return await settle(await api.cosmeticsInteraction.DeleteLoadout(loadoutId), "delete");
  }

  async function assignLoadoutToSpace(spaceId: string | null, loadoutId: string): Promise<boolean> {
    return await settle(await api.cosmeticsInteraction.AssignLoadoutToSpace(spaceId, loadoutId), "assign");
  }

  async function unassignLoadoutFromSpace(spaceId: string | null): Promise<boolean> {
    return await settle(await api.cosmeticsInteraction.UnassignLoadoutFromSpace(spaceId), "unassign");
  }

  async function settle(result: ILoadoutActionResult, what: string): Promise<boolean> {
    if (result.isFailedLoadoutAction()) {
      logger.warn(`Loadout ${what} was refused`, result.error);
      return false;
    }

    await loadLoadouts();
    return true;
  }

  async function equip(loadoutId: string, cosmeticId: string, slotIndex: number, overridesJson?: string) {
    const result = await api.cosmeticsInteraction.Equip(loadoutId, cosmeticId, slotIndex, overridesJson ?? null);

    metrics.count("cosmetic.equipped", {
      result: result.isSuccessEquip() ? "ok" : "refused",
    });

    if (result.isFailedEquip()) {
      logger.warn("Equip was refused", result.error);
      return null;
    }

    if (!result.isSuccessEquip()) return null;

    await loadLoadouts();
    return result.profile;
  }

  async function unequip(loadoutId: string, kindKey: string, slotIndex: number) {
    const result = await api.cosmeticsInteraction.Unequip(loadoutId, kindKey, slotIndex);

    if (result.isFailedEquip()) {
      logger.warn("Unequip was refused", result.error);
      return null;
    }

    if (!result.isSuccessEquip()) return null;

    await loadLoadouts();
    return result.profile;
  }

  return {
    catalogue,
    loadouts,
    editing,
    editingLoadout,
    worn,
    isKindEnabled,
    resolve,
    resolveCatalogueItem,
    catalogueItemById,
    optionsForFacet,
    parseOptionPayload,
    wornBy,
    wornIdentity,
    wornAvatar,
    prefetchWorn,
    forgetWorn,
    loadCatalogue,
    loadLoadouts,
    createLoadout,
    renameLoadout,
    setDefaultLoadout,
    setLoadoutPaused,
    configureCosmetic,
    deleteLoadout,
    assignLoadoutToSpace,
    unassignLoadoutFromSpace,
    setWidgetBoard,
    setLoadoutIdentity,
    equip,
    unequip,
  };
});
