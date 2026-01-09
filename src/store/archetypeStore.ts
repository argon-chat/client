import { logger } from "@argon/core";
import {
  type ArgonEntitlementFlag,
  extractEntitlements,
} from "@/lib/rbac/ArgonEntitlement";
import { liveQuery } from "dexie";
import { defineStore } from "pinia";
import { computed, onUnmounted, ref, watch } from "vue";
import { useApi } from "./apiStore";
import { db } from "./db/dexie";
import { useMe } from "./meStore";
import {
  type Archetype,
  ArgonEntitlement,
  type SpaceMember,
  type SpaceMemberArchetype,
} from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

/**
 * Store for managing roles (archetypes) and permissions
 */
export const useArchetypeStore = defineStore("archetype", () => {
  const api = useApi();
  const me = useMe();

  const currentServerPermissions = ref<Set<ArgonEntitlementFlag>>(new Set());
  let currentSubscription: { unsubscribe(): void } | null = null;

  /**
   * Get server archetypes
   */
  const refreshAllArchetypesForServer = async (serverId: Guid) => {
    const serverArchetypes =
      await api.serverInteraction.GetServerArchetypes(serverId);

    logger.log(
      `Loaded '${serverArchetypes.length}' archetypes`,
      serverArchetypes
    );

    for (const arch of serverArchetypes) {
      await trackArchetype(arch);
    }
  };

  /**
   * Get detailed archetypes and refresh DB
   */
  const getDetailedArchetypesAndRefreshDb = async (serverId: Guid) => {
    const serverArchetypes =
      await api.serverInteraction.GetDetailedServerArchetypes(serverId);

    logger.log(
      `Loaded '${serverArchetypes.length}' archetypes`,
      serverArchetypes
    );

    for (const arch of serverArchetypes) {
      await trackArchetype(arch.archetype);
    }

    return serverArchetypes;
  };

  /**
   * Add/update archetype in DB
   */
  const trackArchetype = async (archetype: Archetype) => {
    await db.archetypes.put(archetype, archetype.id);
  };

  /**
   * Add/update server member
   */
  const trackMember = async (member: SpaceMember) => {
    await db.members.put(member, member.memberId);
  };

  /**
   * Get member IDs by user IDs
   */
  const getMemberIdsByUserIds = async (serverId: Guid, userIds: Guid[]) => {
    const members = await db.members
      .where("[userId+spaceId]")
      .anyOf(userIds.map((id) => [id, serverId] as [Guid, Guid]))
      .toArray();
    return members.map((m) => m.memberId);
  };

  /**
   * Get member IDs by user IDs (reactive)
   */
  const getMemberIdsByUserIdsQuery = (serverId: Guid, userIds: Guid[]) => {
    return liveQuery(async () => {
      return await getMemberIdsByUserIds(serverId, userIds);
    });
  };

  /**
   * Generate badges for archetypes (owner, etc.)
   */
  const generateBadgesByArchetypes = async (
    archetypes: SpaceMemberArchetype[]
  ): Promise<string[]> => {
    if (!archetypes || archetypes.length === 0) return [];

    const ids = archetypes.map((x) => x.archetypeId);

    const results = await db.archetypes
      .where("id")
      .anyOf(ids)
      .filter((q) => q.isHidden && q.isLocked && q.name === "owner")
      .toArray();

    return results.map((x) => x.name);
  };

  /**
   * Track current user permissions on selected server
   */
  const initPermissionsWatcher = (selectedServer: () => Guid | null) => {
    watch(
      [selectedServer, () => me.me?.userId],
      ([serverId, userId]) => {
        currentSubscription?.unsubscribe();

        if (!serverId || !userId) {
          currentServerPermissions.value = new Set();
          return;
        }

        currentSubscription = liveQuery(async () => {
          const member = await db.members
            .where("[userId+spaceId]")
            .equals([userId, serverId])
            .first();

          if (!member) {
            logger.warn("no found member for fetch self entitlement");
            return new Set<ArgonEntitlementFlag>();
          }

          if (!member.archetypes || member.archetypes.length === 0) {
            logger.warn("no archetypes for self member");
            return new Set<ArgonEntitlementFlag>();
          }

          const archetypeIds = member.archetypes.map((a) => a.archetypeId);
          const archetypes = await db.archetypes
            .where("id")
            .anyOf(archetypeIds)
            .toArray();

          const flags = archetypes.flatMap((x) =>
            extractEntitlements(BigInt(x.entitlement))
          );

          return new Set(flags);
        }).subscribe({
          next(value) {
            currentServerPermissions.value = value;
          },
          error(err) {
            console.error("Permissions LiveQuery error", err);
          },
        });
      },
      { immediate: true }
    );
  };

  /**
   * Check permission
   */
  const hasPermission = computed(() => {
    return (flag: ArgonEntitlementFlag): boolean =>
      currentServerPermissions.value.has(flag);
  });

  onUnmounted(() => {
    currentSubscription?.unsubscribe();
  });

  return {
    currentServerPermissions,
    refreshAllArchetypesForServer,
    getDetailedArchetypesAndRefreshDb,
    trackArchetype,
    trackMember,
    getMemberIdsByUserIds,
    getMemberIdsByUserIdsQuery,
    generateBadgesByArchetypes,
    initPermissionsWatcher,
    hasPermission,
  };
});
