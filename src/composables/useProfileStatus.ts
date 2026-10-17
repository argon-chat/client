import {
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef,
} from "vue";
import { logger } from "@argon/core";

import {
  useProfileCacheStore,
  type ProfileStatus,
} from "@/store/data/profileCacheStore";

// By name, not by class: DOMException differs between realms, and test environments bring their own.
function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/**
 * Somebody's list-row status — custom status and what they wear — through the profile cache's
 * batched queue, never a call of its own.
 *
 * Asked only while `wanted` holds, dropped before it reaches the wire when the caller goes away or
 * stops wanting it, and asked again when the cache says what it holds for that person changed.
 */
export function useProfileStatus(
  spaceId: MaybeRefOrGetter<string | null | undefined>,
  userId: MaybeRefOrGetter<string | null | undefined>,
  wanted: MaybeRefOrGetter<boolean>,
): ShallowRef<ProfileStatus | null> {
  const status = shallowRef<ProfileStatus | null>(null);

  let inflight: AbortController | null = null;
  let heldFor: string | null = null;

  const person = () => {
    if (!toValue(wanted)) {
      return null;
    }

    return toValue(userId) ?? null;
  };

  const space = () => toValue(spaceId) ?? null;

  const revision = () => {
    const asked = person();

    return asked === null ? 0 : useProfileCacheStore().revisionOf(asked);
  };

  function ask(asked: string | null, scope: string | null) {
    inflight?.abort();
    inflight = null;

    const identity = asked === null ? null : `${scope ?? ""}:${asked}`;

    // A refresh for the same person keeps what is on screen until the new answer lands.
    if (identity !== heldFor) {
      status.value = null;
      heldFor = identity;
    }

    if (asked === null) {
      return;
    }

    const request = new AbortController();

    inflight = request;

    useProfileCacheStore()
      .getStatus(scope, asked, { signal: request.signal })
      .then(row => {
        if (!request.signal.aborted) {
          status.value = row;
        }
      })
      .catch(error => {
        if (isAbort(error)) {
          return;
        }

        logger.debug("Could not read a profile status", asked, error);
      });
  }

  watch(
    [person, space, revision],
    ([asked, scope]) => ask(asked, scope),
    { immediate: true },
  );

  onScopeDispose(() => inflight?.abort());

  return status;
}
