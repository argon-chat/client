import { ref, watch, onScopeDispose, type Ref } from "vue";
import { liveQuery, type Subscription } from "dexie";
import { logger } from "@argon/core";
import type { Archetype, ArgonChannel, ChannelEntitlementOverwrite } from "@argon/glue";
import { db } from "@/store/db/dexie";
import { useApi } from "@/store/system/apiStore";
import { entitlementBit } from "@/lib/rbac/ArgonEntitlement";

/**
 * Whether turning on broadcast mode lets everyone who can join the channel transmit.
 *
 * When the mode goes on, the server writes a visible Broadcast=Allow overwrite for the space's
 * default ("everyone") archetype. So unless that archetype is denied Broadcast on this channel,
 * anyone it lets in and speak can hold the key. The settings tab says so, with a way to narrow it.
 */

const asBits = (value: unknown): bigint => BigInt(value as bigint | number | string);

/** The archetype's rights on the channel after its overwrite: `(base & ~deny) | allow`. */
export function effectiveEntitlement(archetype: Pick<Archetype, "entitlement">, overwrite?: Pick<ChannelEntitlementOverwrite, "allow" | "deny"> | null): bigint {
  const base = asBits(archetype.entitlement);
  if (!overwrite) return base;
  return (base & ~asBits(overwrite.deny)) | asBits(overwrite.allow);
}

export function isBroadcastOpenToEveryone(
  defaultArchetype: Pick<Archetype, "entitlement"> | null | undefined,
  overwrite?: Pick<ChannelEntitlementOverwrite, "allow" | "deny"> | null,
): boolean {
  if (!defaultArchetype) return false;
  const effective = effectiveEntitlement(defaultArchetype, overwrite);
  const has = (flag: "Connect" | "Speak") => (effective & entitlementBit(flag)) !== 0n;
  const broadcastDenied = overwrite ? (asBits(overwrite.deny) & entitlementBit("Broadcast")) !== 0n : false;
  return has("Connect") && has("Speak") && !broadcastDenied;
}

/**
 * Follows the default archetype from Dexie and re-reads the channel's overwrites whenever the
 * caller says the permissions may have changed (`refresh`), or the channel or the mode does.
 */
export function useBroadcastOpenWarning(channel: Ref<ArgonChannel>, enabled: Ref<boolean>) {
  const api = useApi();
  const open = ref(false);
  const defaultArchetype = ref<Archetype | null>(null);
  const overwrites = ref<ChannelEntitlementOverwrite[]>([]);

  let sub: Subscription | null = null;
  const followArchetype = (spaceId: string) => {
    sub?.unsubscribe();
    sub = liveQuery(() =>
      db.archetypes.where("spaceId").equals(spaceId).filter((a) => a.isDefault).first(),
    ).subscribe({
      next: (row) => {
        defaultArchetype.value = row ?? null;
        recompute();
      },
      error: (e) => logger.error("[BroadcastOpenWarning] archetype query failed", e),
    });
  };

  const refresh = async () => {
    if (!enabled.value) {
      open.value = false;
      return;
    }
    const { spaceId, channelId } = channel.value;
    try {
      const result = await api.archetypeInteraction.GetChannelEntitlementOverwrites(spaceId, channelId);
      // The channel may have changed under the request; only the answer for the current one counts.
      if (channel.value.channelId !== channelId) return;
      overwrites.value = [...result];
    } catch (e) {
      logger.warn("[BroadcastOpenWarning] overwrites failed to load", e);
      overwrites.value = [];
    }
    recompute();
  };

  const recompute = () => {
    if (!enabled.value || !defaultArchetype.value) {
      open.value = false;
      return;
    }
    const archetypeId = defaultArchetype.value.id;
    const overwrite = overwrites.value.find((o) => o.archetypeId === archetypeId) ?? null;
    open.value = isBroadcastOpenToEveryone(defaultArchetype.value, overwrite);
  };

  watch(
    () => channel.value.spaceId,
    (spaceId) => followArchetype(spaceId),
    { immediate: true },
  );

  watch(
    () => [channel.value.channelId, enabled.value] as const,
    () => void refresh(),
    { immediate: true },
  );

  onScopeDispose(() => sub?.unsubscribe());

  return { open, refresh };
}
