import { liveQuery, type Subscription } from "dexie";
import { type Ref, onUnmounted, ref, watch } from "vue";
import { db, type RealtimeUser } from "@/store/db/dexie";
import { type Archetype, UserStatus, ArgonEntitlement } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

export function useGroupedServerUsers(serverId: Ref<Guid | null | undefined>) {
  const result = ref<{ archetype: Archetype; users: RealtimeUser[] }[]>([]);
  let sub: Subscription | null = null;

  async function buildGroups(id: Guid) {
    const server = await db.servers.where("spaceId").equals(id).first();
    if (!server) return [];

    const members = await db.members
      .where("spaceId")
      .equals(server.spaceId)
      .toArray();

    const users = (
      await db.users.bulkGet(members.map((m) => m.userId))
    ).filter((u): u is RealtimeUser => !!u);

    const allArchetypeIds = [
      ...new Set(
        members.flatMap((m) => m.archetypes.map((a) => a.archetypeId))
      ),
    ];

    const archetypes = (await db.archetypes.bulkGet(allArchetypeIds)).filter(
      (a): a is Archetype => !!a
    );

    const archetypesMap = new Map(archetypes.map((a) => [a.id, a]));
    const groupArchetypes = [...archetypesMap.values()]
      .filter((a) => a.isGroup)
      .sort((a, b) => a.name.localeCompare(b.name));

    const memberMap = new Map(members.map((m) => [m.userId, m]));
    const usersWithArchetypes = users.map((user) => {
      const member = memberMap.get(user.userId);
      if (member) {
        user.archetypes = member.archetypes
          .map((x) => archetypesMap.get(x.archetypeId))
          .filter((a): a is Archetype => !!a);
      }
      return user;
    });

    const sortFn = (a: RealtimeUser, b: RealtimeUser) => {
      const statusOrder = (status: UserStatus) => {
        if (status === UserStatus.Online) return 0;
        if (status === UserStatus.Offline) return 2;
        return 1;
      };
      const statusDiff = statusOrder(a.status) - statusOrder(b.status);
      if (statusDiff !== 0) return statusDiff;
      return a.displayName.localeCompare(b.displayName);
    };
    usersWithArchetypes.sort(sortFn);

    const groupMap = new Map<Guid, RealtimeUser[]>();
    const ungroupedUsers: RealtimeUser[] = [];
    const offlineUsers: RealtimeUser[] = [];
    const seen = new Set<Guid>();

    for (const user of usersWithArchetypes) {
      if (seen.has(user.userId)) continue;

      if (user.status === UserStatus.Offline) {
        offlineUsers.push(user);
        seen.add(user.userId);
        continue;
      }

      const groupRoles = (user.archetypes ?? []).filter((a) => a.isGroup);
      const target = groupRoles.find((r) => archetypesMap.get(r.id)?.isGroup);
      if (target) {
        if (!groupMap.has(target.id)) groupMap.set(target.id, []);
        groupMap.get(target.id)!.push(user);
      } else {
        ungroupedUsers.push(user);
      }
      seen.add(user.userId);
    }

    const result: { archetype: Archetype; users: RealtimeUser[] }[] = [];

    for (const group of groupArchetypes) {
      const groupUsers = groupMap.get(group.id) ?? [];
      if (groupUsers.length > 0) {
        result.push({ archetype: group, users: groupUsers });
      }
    }

    if (ungroupedUsers.length > 0) {
      result.push({
        archetype: {
          id: "00000000-0000-0000-0000-000000000000",
          spaceId: id,
          name: "Users",
          description: "",
          isMentionable: false,
          colour: 0xffffffff,
          isHidden: false,
          isLocked: false,
          isGroup: true,
          entitlement: ArgonEntitlement.None,
          isDefault: false,
          iconFileId: null,
        },
        users: ungroupedUsers,
      });
    }

    if (offlineUsers.length > 0) {
      result.push({
        archetype: {
          id: "00000000-0000-0000-0000-000000000001",
          spaceId: id,
          name: "Offline",
          description: "All offline users",
          isMentionable: false,
          colour: 0xffaaaaaa,
          isHidden: false,
          isLocked: false,
          isGroup: true,
          entitlement: ArgonEntitlement.None,
          isDefault: false,
          iconFileId: null,
        },
        users: offlineUsers,
      });
    }

    return result;
  }

  watch(
    serverId,
    (id) => {
      sub?.unsubscribe();
      if (!id) {
        result.value = [];
        return;
      }

      sub = liveQuery(() => buildGroups(id)).subscribe({
        next: (groups) => {
          result.value = groups;
        },
        error: (err) => console.error("[GroupedUsers] liveQuery error:", err),
      });
    },
    { immediate: true }
  );

  onUnmounted(() => sub?.unsubscribe());

  return result;
}
