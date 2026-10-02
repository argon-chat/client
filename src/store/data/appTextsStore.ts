import { defineStore } from "pinia";
import { shallowReactive } from "vue";
import { logger } from "@argon/core";
import type { LocalizedText } from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { db } from "@/store/db/dexie";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { fingerprintLocalized, pickLocalized, toAppRef, type AppRefKey } from "@/lib/appTexts";

/** How often an application's strings are asked about at most; an edit reaches readers within this long. */
export const APP_TEXTS_REVALIDATE_MS = 10 * 60_000;
/** After a failed request, how soon the next one may go out. */
export const APP_TEXTS_RETRY_MS = 30_000;

interface AppTextsEntry {
  version: number;
  /** The keys this copy was fetched for; a key outside them is fetched fresh. */
  keys: string[];
  texts: LocalizedText[];
}

/**
 * Applications' localized strings (a bot's MOTD), cached on disk by the version the server gave
 * them. A revalidation sends that version back and gets the strings only when they changed.
 */
export const useAppTextsStore = defineStore("appTexts", () => {
  const api = useApi();

  const byApp = shallowReactive(new Map<AppRefKey, AppTextsEntry>());
  const nextCheckAt = new Map<AppRefKey, number>();
  const retryAt = new Map<AppRefKey, number>();
  const inflight = new Map<AppRefKey, Promise<void>>();
  let generation = 0;

  async function hydrate(ref: AppRefKey, gen: number): Promise<void> {
    if (byApp.has(ref)) return;
    try {
      const row = await db.appTexts.get(ref);
      if (gen !== generation || !row || byApp.has(ref)) return;
      byApp.set(ref, { version: row.version, keys: row.keys, texts: row.texts });
      nextCheckAt.set(ref, row.checkedAt + APP_TEXTS_REVALIDATE_MS);
    } catch (e) {
      logger.warn("[appTexts] cache read failed", ref, e);
    }
  }

  async function revalidate(ref: AppRefKey, keys: string[], known: number | null, gen: number): Promise<void> {
    const current = byApp.get(ref);
    let answer: { version: number; texts: LocalizedText[] | null };
    try {
      const result = await api.userInteraction.LookupAppTexts(toAppRef(ref), keys, known);
      // No such application: remembered as one without strings, so it is not asked about on every open.
      answer = result.isSuccessLookupAppTexts() ? result.texts : { version: 0, texts: [] };
    } catch (e) {
      logger.warn("[appTexts] lookup failed", ref, e);
      if (gen === generation) retryAt.set(ref, Date.now() + APP_TEXTS_RETRY_MS);
      return;
    }
    if (gen !== generation) return;

    const checkedAt = Date.now();
    nextCheckAt.set(ref, checkedAt + APP_TEXTS_REVALIDATE_MS);

    const entry: AppTextsEntry =
      answer.texts === null && current ? current : { version: answer.version, keys, texts: answer.texts ?? [] };
    if (entry !== current) byApp.set(ref, entry);

    try {
      await db.appTexts.put({ ref, version: entry.version, keys: entry.keys, texts: entry.texts, checkedAt });
    } catch (e) {
      logger.warn("[appTexts] cache write failed", ref, e);
    }
  }

  /**
   * The cached copy first, then the server: at once for a key the copy was not fetched for, and
   * otherwise at most once per APP_TEXTS_REVALIDATE_MS.
   */
  function ensureLoaded(ref: AppRefKey, keys: readonly string[]): Promise<void> {
    const running = inflight.get(ref);
    if (running) return running.then(() => ensureLoaded(ref, keys));

    const gen = generation;
    const run = (async () => {
      await hydrate(ref, gen);
      const now = Date.now();
      if (gen !== generation || now < (retryAt.get(ref) ?? 0)) return;

      const entry = byApp.get(ref);
      const missing = keys.filter((key) => !entry?.keys.includes(key));
      if (missing.length === 0 && now < (nextCheckAt.get(ref) ?? 0)) return;

      const wanted = [...new Set([...(entry?.keys ?? []), ...keys])].sort();
      await revalidate(ref, wanted, missing.length === 0 ? (entry?.version ?? null) : null, gen);
    })().finally(() => {
      if (gen === generation) inflight.delete(ref);
    });
    inflight.set(ref, run);
    return run;
  }

  function text(ref: AppRefKey, key: string, locale: string): string | null {
    const entry = byApp.get(ref);
    return entry ? pickLocalized(entry.texts, key, locale) : null;
  }

  /** Changes whenever any locale of the key does; see fingerprintLocalized. */
  function fingerprint(ref: AppRefKey, key: string): string | null {
    const entry = byApp.get(ref);
    return entry ? fingerprintLocalized(entry.texts, key) : null;
  }

  onSessionReset(() => {
    generation++;
    byApp.clear();
    nextCheckAt.clear();
    retryAt.clear();
    inflight.clear();
  });

  return { ensureLoaded, text, fingerprint };
});
