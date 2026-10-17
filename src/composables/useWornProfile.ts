import {
  computed,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
} from "vue";
import type { ArgonUserProfile } from "@argon/glue";

import { useMe } from "@/store/auth/meStore";

type WornProfile = Pick<ArgonUserProfile, "cosmetics">;

/**
 * What to draw somebody wearing: the caller's own look straight from `meProfile`, which an equip
 * replaces at once, and anybody else's from the row the surface already holds.
 */
export function useWornProfile(
  userId: MaybeRefOrGetter<string | null | undefined>,
  held: MaybeRefOrGetter<WornProfile | null | undefined>,
): ComputedRef<WornProfile | null> {
  const me = useMe();

  return computed(() => {
    const person = toValue(userId);

    if (person && person === me.me?.userId && me.meProfile) {
      return me.meProfile;
    }

    return toValue(held) ?? null;
  });
}
