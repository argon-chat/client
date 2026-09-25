import { defineStore } from "pinia";
import { usePoolStore } from "@/store/data/poolStore";
import { useArchetypeStore } from "@/store/data/archetypeStore";
import { useEntitlementStore } from "@/store/data/entitlementStore";
import { type ArgonEntitlementFlag, entitlementBit } from "@/lib/rbac/ArgonEntitlement";

/**
 * How a control that needs a permission is shown:
 * - `allowed`: usable.
 * - `denied`: the space grants it but this channel takes it away — show it disabled, say why.
 * - `hidden`: nothing in this space grants it — leave it out.
 */
export type PermissionGate = "allowed" | "denied" | "hidden";

/**
 * Permission checks for the UI, answered from the server's own evaluation (entitlementStore).
 *
 * Until a space's first answer arrives, both kinds of check fall back to the local reading of the
 * member's roles, so controls do not flash disabled on startup.
 */
export const usePexStore = defineStore("pex", () => {
  const pool = usePoolStore();
  const archetypes = useArchetypeStore();
  const entitlements = useEntitlementStore();

  const local = (flag: ArgonEntitlementFlag) => archetypes.hasPermission(flag);

  /** Whether the server has answered for this space yet. */
  function ready(spaceId: string | null | undefined): boolean {
    if (!spaceId) return false;
    if (entitlements.get(spaceId)) return true;
    entitlements.ensure(spaceId);
    return false;
  }

  function hasInSpace(spaceId: string | null | undefined, flag: ArgonEntitlementFlag): boolean {
    if (!spaceId) return local(flag);
    const grants = entitlements.get(spaceId);
    if (!grants) {
      entitlements.ensure(spaceId);
      return local(flag);
    }
    return (grants.space & entitlementBit(flag)) !== 0n;
  }

  /** Space-level, in the space on screen. */
  function has(flag: ArgonEntitlementFlag): boolean {
    return hasInSpace(pool.selectedServer, flag);
  }

  /** In one channel, after its overwrites. A channel the answer does not list is a no. */
  function hasIn(channelId: string | null | undefined, flag: ArgonEntitlementFlag, spaceId?: string | null): boolean {
    const space = spaceId ?? (channelId ? entitlements.spaceOf(channelId) : undefined) ?? pool.selectedServer;
    if (!space) return local(flag);
    const grants = entitlements.get(space);
    if (!grants) {
      entitlements.ensure(space);
      return local(flag);
    }
    if (!channelId) return false;
    const mask = grants.channels.get(channelId);
    return mask !== undefined && (mask & entitlementBit(flag)) !== 0n;
  }

  function gate(channelId: string | null | undefined, flag: ArgonEntitlementFlag, spaceId?: string | null): PermissionGate {
    if (hasIn(channelId, flag, spaceId)) return "allowed";
    const space = spaceId ?? (channelId ? entitlements.spaceOf(channelId) : undefined) ?? pool.selectedServer;
    return hasInSpace(space, flag) ? "denied" : "hidden";
  }

  return { has, hasInSpace, hasIn, gate, ready };
});
