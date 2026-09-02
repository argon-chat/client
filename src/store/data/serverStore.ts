import { toast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { defineStore } from "pinia";
import { metrics, enumName, errorKind, bucket } from "@/lib/telemetry/metrics";
import { ref } from "vue";
import { useApi } from "@/store/system/apiStore";
import { usePoolStore } from "@/store/data/poolStore";
import {
  AcceptInviteError,
  ChannelType,
  InviteCode,
  ServerInvites,
  SpaceDeletionStatus,
  type SpaceDeletionState,
} from "@argon/glue";
import { v7 } from "uuid";
import { Guid } from "@argon-chat/ion.webcore";

export const useSpaceStore = defineStore("spaces", () => {
  const api = useApi();
  const isBeginConnect = ref(false);
  const isConnected = ref(false);
  const pool = usePoolStore();

  /**
   * Spaces with a deletion scheduled, by id.
   *
   * Held here rather than in `db.servers` because it is not part of `ArgonSpaceBase` and does not
   * want to be cached: the countdown is only meaningful live, and a stale row read after the space
   * is gone would show a date that already passed. Populated by the realtime events and by the
   * settings screen when it opens.
   */
  const scheduledDeletions = ref(new Map<Guid, SpaceDeletionState>());

  const setDeletionState = (spaceId: Guid, state: SpaceDeletionState | null) => {
    const next = new Map(scheduledDeletions.value);

    if (state === null || state.status === SpaceDeletionStatus.NONE) next.delete(spaceId);
    else next.set(spaceId, state);

    scheduledDeletions.value = next;
  };

  const deletionStateOf = (spaceId: Guid) => scheduledDeletions.value.get(spaceId) ?? null;

  async function createServer(name: string): Promise<boolean> {
    try {
      await api.userInteraction.CreateSpace({
        avatarFieldId: "",
        description: "",
        name: name,
      });
    } catch (e) {
      logger.error("failed to create server", e);
      metrics.count("space.created", { result: "failed", error: errorKind(e) });
      return false;
    }
    // Created. Counted here, so a refresh that fails below cannot turn a real creation into a failure.
    metrics.count("space.created", { result: "ok" });
    try {
      await pool.loadServerDetails();
      return true;
    } catch (e) {
      logger.error("created the server, but failed to reload the space list", e);
      return false;
    }
  }

  async function joinToServer(inviteCode: string): Promise<string> {
    const r = await api.userInteraction.JoinToSpace({
      inviteCode,
    });

    metrics.count("space.joined", {
      result: r.isSuccessJoin() ? "ok" : "failed",
      error: r.isFailedJoin() ? enumName(AcceptInviteError, r.error) : undefined,
    });

    if (r.isSuccessJoin()) {
      await pool.loadServerDetails();
      return '';
    } else if (r.isFailedJoin()) {
      switch (r.error) {
        case AcceptInviteError.EXPIRED:
          return "Invite code expired";
        case AcceptInviteError.LIMIT_REACHED:
          return "This invite has reached its usage limit";
        case AcceptInviteError.NOT_FOUND:
        case AcceptInviteError.YOU_ARE_BANNED:
          return "Invite code incorrect";
      }
    }
    return "Unknown error";
  }

  async function addChannelToServer(
    spaceId: Guid,
    channelName: string,
    channelKind: ChannelType,
    groupId: Guid | null = null
  ) {
    await api.channelInteraction.CreateChannel(spaceId, v7(), {
      name: channelName,
      desc: "",
      kind: channelKind,
      spaceId: spaceId,
      groupId: groupId
    });
    metrics.count("channel.created", { kind: enumName(ChannelType, channelKind), grouped: groupId !== null });
  }

  async function deleteChannel(channelId: string) {
    const selectedServer = pool.selectedServer;
    if (!selectedServer) return;

    await api.channelInteraction.DeleteChannel(selectedServer, channelId);
    metrics.count("channel.deleted");
  }

  async function getServerInvites(): Promise<ServerInvites | null> {
    const selectedServer = pool.selectedServer;
    if (!selectedServer) return null;

    return api.serverInteraction.GetInviteCodes(selectedServer);
  }

  /**
   * Create an invite.
   * @param expireMinutes minutes until expiry, or 0 for "never".
   * @param maxUses maximum joins allowed, or 0 for "unlimited".
   */
  async function addInvite(expireMinutes: number, maxUses: number): Promise<InviteCode | null> {
    const selectedServer = pool.selectedServer;
    if (!selectedServer) return null;

    const invite = await api.serverInteraction.CreateInviteCode(selectedServer, expireMinutes, maxUses);
    metrics.count("space.invite.created", {
      expires: expireMinutes === 0 ? "never" : bucket(expireMinutes, [60, 1440, 10080]),
      uses: maxUses === 0 ? "unlimited" : bucket(maxUses, [5, 25, 100]),
    });
    return invite;
  }

  async function revokeInvite(code: InviteCode): Promise<void> {
    const selectedServer = pool.selectedServer;
    if (!selectedServer) return;

    await api.serverInteraction.RevokeInviteCode(selectedServer, code);
    metrics.count("space.invite.revoked");
  }

  return {
    isBeginConnect,
    isConnected,
    scheduledDeletions,
    setDeletionState,
    deletionStateOf,
    joinToServer,
    addChannelToServer,
    deleteChannel,
    getServerInvites,
    addInvite,
    revokeInvite,
    createServer,
  };
});
