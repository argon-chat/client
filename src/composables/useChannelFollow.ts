import { computed, ref } from "vue";
import type { IonDateTime } from "@argon-chat/ion.webcore";
import {
  ChannelType,
  EntityType,
  FollowChannelError,
  PublishMessageError,
  RemoveFollowError,
  type ArgonChannel,
  type ArgonMessage,
  type ArgonSpaceBase,
  type ChannelFollowLink,
  type ChannelGroup,
  type IFollowChannelResult,
  type IPublishMessageResult,
  type IRemoveFollowResult,
} from "@argon/glue";
import { logger } from "@argon/core";
import { useToast } from "@argon/ui/toast";
import { useApi } from "@/store/system/apiStore";
import { metrics, errorKind, COUNT_EDGES } from "@/lib/telemetry/metrics";
import { useLocale } from "@/store/system/localeStore";
import { usePoolStore } from "@/store/data/poolStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useChannelGroups } from "@/composables/useChannelGroups";
import { SYSTEM_USER_ID } from "@/composables/useMessageContent";
import type { ChatMessage } from "@/composables/useChatMessages";

/**
 * Following announcement channels and publishing to the followers.
 *
 * A channel with ManageChannels can follow an announcement channel it can see; a message published
 * there is copied into every follower as a crosspost — a normal message whose `crosspost` says
 * where it came from, sent in the name of an author who is usually not a member here.
 */

// ── Results ──

export type FollowOutcome = { ok: true; link: ChannelFollowLink } | { ok: false; errorKey: string };
export type RemoveFollowOutcome = { ok: true } | { ok: false; errorKey: string };
export type PublishOutcome =
  | { ok: true; deliveredCount: number; targetCount: number; publishedAt: IonDateTime }
  | { ok: false; errorKey: string; error: PublishMessageError | null };

const FOLLOW_ERROR_KEYS: Record<FollowChannelError, string> = {
  [FollowChannelError.NONE]: "follow_error_unknown",
  [FollowChannelError.SOURCE_NOT_FOUND]: "follow_error_source_not_found",
  [FollowChannelError.NOT_AN_ANNOUNCEMENT_CHANNEL]: "follow_error_not_announcement",
  [FollowChannelError.NO_ACCESS_TO_SOURCE]: "follow_error_no_access",
  [FollowChannelError.TARGET_NOT_FOUND]: "follow_error_target_not_found",
  [FollowChannelError.TARGET_NOT_TEXT]: "follow_error_target_not_text",
  [FollowChannelError.INSUFFICIENT_PERMISSIONS]: "follow_error_no_permission",
  [FollowChannelError.SAME_CHANNEL]: "follow_error_same_channel",
  [FollowChannelError.ALREADY_FOLLOWING]: "follow_error_already_following",
  [FollowChannelError.TOO_MANY_FOLLOWS]: "follow_error_too_many",
  [FollowChannelError.SOURCE_PRIVATE]: "follow_error_source_private",
  [FollowChannelError.SOURCE_FOLLOWER_LIMIT]: "follow_error_source_full",
};

const PUBLISH_ERROR_KEYS: Record<PublishMessageError, string> = {
  [PublishMessageError.NONE]: "publish_error_unknown",
  [PublishMessageError.MESSAGE_NOT_FOUND]: "publish_error_not_found",
  [PublishMessageError.NOT_AN_ANNOUNCEMENT_CHANNEL]: "publish_error_not_announcement",
  [PublishMessageError.INSUFFICIENT_PERMISSIONS]: "publish_error_no_permission",
  [PublishMessageError.ALREADY_PUBLISHED]: "publish_error_already_published",
  [PublishMessageError.PUBLISH_RATE_LIMITED]: "publish_error_rate_limited",
  [PublishMessageError.NOT_PUBLISHABLE]: "publish_error_not_publishable",
};

const REMOVE_FOLLOW_ERROR_KEYS: Record<RemoveFollowError, string> = {
  [RemoveFollowError.NONE]: "follow_error_unknown",
  [RemoveFollowError.FOLLOW_NOT_FOUND]: "follow_remove_error_not_found",
  [RemoveFollowError.INSUFFICIENT_PERMISSIONS]: "follow_remove_error_no_permission",
};

export const followErrorKey = (error: FollowChannelError): string =>
  FOLLOW_ERROR_KEYS[error] ?? FOLLOW_ERROR_KEYS[FollowChannelError.NONE];

export const publishErrorKey = (error: PublishMessageError): string =>
  PUBLISH_ERROR_KEYS[error] ?? PUBLISH_ERROR_KEYS[PublishMessageError.NONE];

export const removeFollowErrorKey = (error: RemoveFollowError): string =>
  REMOVE_FOLLOW_ERROR_KEYS[error] ?? REMOVE_FOLLOW_ERROR_KEYS[RemoveFollowError.NONE];

export function toFollowOutcome(result: IFollowChannelResult): FollowOutcome {
  if (result.isSuccessFollowChannel()) return { ok: true, link: result.link };
  return { ok: false, errorKey: followErrorKey(result.isFailedFollowChannel() ? result.error : FollowChannelError.NONE) };
}

export function toPublishOutcome(result: IPublishMessageResult): PublishOutcome {
  if (result.isSuccessPublishMessage()) {
    return {
      ok: true,
      deliveredCount: result.deliveredCount,
      targetCount: result.targetCount,
      publishedAt: result.publishedAt,
    };
  }
  const error = result.isFailedPublishMessage() ? result.error : null;
  return { ok: false, errorKey: publishErrorKey(error ?? PublishMessageError.NONE), error };
}

/** Gone already counts as removed: somebody else took it down first. */
export function toRemoveFollowOutcome(result: IRemoveFollowResult): RemoveFollowOutcome {
  // Failure first: the success case has no fields, so testing it first narrows the rest to never.
  if (result.isFailedRemoveFollow()) {
    if (result.error === RemoveFollowError.FOLLOW_NOT_FOUND) return { ok: true };
    return { ok: false, errorKey: removeFollowErrorKey(result.error) };
  }
  return result.isSuccessRemoveFollow() ? { ok: true } : { ok: false, errorKey: removeFollowErrorKey(RemoveFollowError.NONE) };
}

/** The description under "Published to followers": no plural forms, so it reads right in every locale. */
export function publishSuccessDescription(outcome: { deliveredCount: number; targetCount: number }): {
  key: string;
  params: Record<string, number>;
} {
  const { deliveredCount, targetCount } = outcome;
  if (targetCount <= 0) return { key: "publish_success_no_followers", params: {} };
  if (deliveredCount >= targetCount) return { key: "publish_success_reached", params: { n: deliveredCount } };
  return { key: "publish_success_partial", params: { delivered: deliveredCount, total: targetCount } };
}

// ── Publishing ──

const SYSTEM_ENTITY_TYPES = new Set<EntityType>([
  EntityType.SystemCallStarted,
  EntityType.SystemCallEnded,
  EntityType.SystemCallTimeout,
  EntityType.SystemUserJoined,
]);

export function isSystemMessage(message: Pick<ArgonMessage, "sender" | "entities">): boolean {
  return message.sender === SYSTEM_USER_ID || (message.entities ?? []).some((e) => SYSTEM_ENTITY_TYPES.has(e.type));
}

const isAnnouncement = (type: ChannelType | "text" | "announcement" | null | undefined) =>
  type === "announcement" || type === ChannelType.Announcement;

/**
 * Whether "Publish to followers" is offered on a message: in an announcement channel, to its author
 * or a ManageMessages holder, once it is on the server, and only once. A crosspost is a copy and
 * is not published on; neither is a system message.
 */
export function canPublishMessage(input: {
  channelType: ChannelType | "text" | "announcement" | null | undefined;
  message: ChatMessage;
  myUserId: string | null | undefined;
  canManageMessages: boolean;
}): boolean {
  const { channelType, message, myUserId, canManageMessages } = input;
  if (!isAnnouncement(channelType)) return false;
  if (message._optimistic || message._failed) return false;
  if (message.publishedAt || message.crosspost) return false;
  if (isSystemMessage(message)) return false;
  return canManageMessages || (!!myUserId && message.sender === myUserId);
}

// ── Crossposts ──

export interface CrosspostHeader {
  spaceId: string;
  spaceName: string;
  channelName: string;
  avatarFileId: string | null;
  /** "Space • #channel" */
  label: string;
}

export function crosspostHeaderOf(message: Pick<ArgonMessage, "crosspost">): CrosspostHeader | null {
  const xp = message.crosspost;
  if (!xp) return null;
  return {
    spaceId: xp.sourceSpaceId,
    spaceName: xp.sourceSpaceName,
    channelName: xp.sourceChannelName,
    avatarFileId: xp.sourceSpaceAvatarFileId,
    label: `${xp.sourceSpaceName} • #${xp.sourceChannelName}`,
  };
}

/** A crosspost renders without its author: they are usually not a member here, so not in the local users. */
export function shouldRenderMessage(user: unknown, message: Pick<ArgonMessage, "crosspost">): boolean {
  return !!user || !!message.crosspost;
}

/** The name a reply shows: the source space for a crosspost that hides its author or whose author is not known here. */
export function replyAuthorName(
  message: Pick<ArgonMessage, "crosspost"> | null | undefined,
  user: { displayName?: string } | null | undefined,
): string | null {
  const xp = message?.crosspost;
  if (xp?.hideAuthor) return xp.sourceSpaceName;
  return user?.displayName || xp?.sourceSpaceName || null;
}

// ── Picking where to follow into ──

export interface FollowTargetSection {
  key: string;
  /** The category's name; null for the channels outside any. */
  name: string | null;
  channels: ArgonChannel[];
}

/** The user's spaces where they can manage channels, by name. */
export function followableSpaces(
  spaces: readonly ArgonSpaceBase[],
  canManageIn: (spaceId: string) => boolean,
): ArgonSpaceBase[] {
  return spaces
    .filter((s) => canManageIn(s.spaceId))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

const byFractionalIndex = <T extends { fractionalIndex: string | null }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => {
    if (a.fractionalIndex === null && b.fractionalIndex === null) return 0;
    if (a.fractionalIndex === null) return 1;
    if (b.fractionalIndex === null) return -1;
    return a.fractionalIndex.localeCompare(b.fractionalIndex);
  });

/**
 * The text and announcement channels of a space that can receive posts, grouped and ordered as the
 * sidebar shows them: channels outside any category first, then each category in its order.
 */
export function followTargetSections(
  channels: readonly ArgonChannel[],
  groups: readonly ChannelGroup[],
  opts: { sourceChannelId: string; canManageIn: (channelId: string) => boolean },
): FollowTargetSection[] {
  const eligible = channels.filter(
    (c) =>
      (c.type === ChannelType.Text || c.type === ChannelType.Announcement) &&
      c.channelId !== opts.sourceChannelId &&
      opts.canManageIn(c.channelId),
  );
  const known = new Set(groups.map((g) => g.groupId));
  const sections: FollowTargetSection[] = [];

  // A channel whose category is not known locally is shown with the loose ones rather than lost.
  const loose = byFractionalIndex(eligible.filter((c) => c.groupId === null || !known.has(c.groupId)));
  if (loose.length) sections.push({ key: "ungrouped", name: null, channels: loose });

  for (const group of byFractionalIndex(groups)) {
    const rows = byFractionalIndex(eligible.filter((c) => c.groupId === group.groupId));
    if (rows.length) sections.push({ key: group.groupId, name: group.name, channels: rows });
  }
  return sections;
}

/** The follow dialog's pickers: spaces to choose from and, for the chosen one, its eligible channels. */
export function useFollowTargets(sourceChannelId: () => string) {
  const pool = usePoolStore();
  const pex = usePexStore();

  const allSpaces = pool.useAllServers();
  const selectedSpaceId = ref<string>("");
  const selectedChannelId = ref<string>("");

  const spaces = computed(() => followableSpaces(allSpaces.value, (id) => pex.hasInSpace(id, "ManageChannels")));

  const spaceRef = computed<string | null>(() => selectedSpaceId.value || null);
  const channels = pool.useActiveServerChannels(spaceRef);
  const { channelGroups } = useChannelGroups(selectedSpaceId);

  const sections = computed(() =>
    selectedSpaceId.value
      ? followTargetSections(channels.value, channelGroups.value, {
          sourceChannelId: sourceChannelId(),
          canManageIn: (id) => pex.hasIn(id, "ManageChannels", selectedSpaceId.value),
        })
      : [],
  );

  const selectedChannel = computed(
    () => sections.value.flatMap((s) => s.channels).find((c) => c.channelId === selectedChannelId.value) ?? null,
  );

  function pickSpace(spaceId: string) {
    if (selectedSpaceId.value === spaceId) return;
    selectedSpaceId.value = spaceId;
    selectedChannelId.value = "";
  }

  function reset() {
    selectedSpaceId.value = "";
    selectedChannelId.value = "";
  }

  return { spaces, sections, selectedSpaceId, selectedChannelId, selectedChannel, pickSpace, reset };
}

// ── Calls ──

export function useChannelFollow() {
  const api = useApi();

  /** `source` is the announcement channel; `target` the channel that will receive its posts. */
  async function follow(
    source: { spaceId: string; channelId: string },
    target: { spaceId: string; channelId: string },
  ): Promise<FollowOutcome> {
    try {
      const result = await api.channelFollowInteraction.FollowChannel(
        source.spaceId,
        source.channelId,
        target.spaceId,
        target.channelId,
      );
      metrics.count("announcement.followed", result.isSuccessFollowChannel()
        ? { result: "ok", scope: source.spaceId === target.spaceId ? "same_space" : "other_space" }
        : { result: "failed", error: metrics.enumName(FollowChannelError, result.isFailedFollowChannel() ? result.error : FollowChannelError.NONE) });
      return toFollowOutcome(result);
    } catch (e) {
      metrics.count("announcement.followed", { result: "failed", error: errorKind(e) });
      logger.error("[ChannelFollow] FollowChannel failed", e);
      return { ok: false, errorKey: followErrorKey(FollowChannelError.NONE) };
    }
  }

  async function publish(spaceId: string, channelId: string, messageId: bigint): Promise<PublishOutcome> {
    try {
      const outcome = toPublishOutcome(await api.channelFollowInteraction.PublishMessage(spaceId, channelId, messageId));
      metrics.count("announcement.published", outcome.ok
        ? { result: "ok", reach: metrics.bucket(outcome.targetCount, COUNT_EDGES) }
        : { result: "failed", error: metrics.enumName(PublishMessageError, outcome.error ?? PublishMessageError.NONE) });
      return outcome;
    } catch (e) {
      metrics.count("announcement.published", { result: "failed", error: errorKind(e) });
      logger.error("[ChannelFollow] PublishMessage failed", e);
      return { ok: false, errorKey: publishErrorKey(PublishMessageError.NONE), error: null };
    }
  }

  /** Channels following this one (source side). Throws when the call fails. */
  async function followers(spaceId: string, channelId: string): Promise<ChannelFollowLink[]> {
    return [...(await api.channelFollowInteraction.GetFollowers(spaceId, channelId))];
  }

  /** Channels this one follows (target side). Throws when the call fails. */
  async function followedSources(spaceId: string, channelId: string): Promise<ChannelFollowLink[]> {
    return [...(await api.channelFollowInteraction.GetFollowedSources(spaceId, channelId))];
  }

  /** Either end may remove a follow, from the channel whose settings are open. */
  async function removeFollow(spaceId: string, channelId: string, followId: string): Promise<RemoveFollowOutcome> {
    try {
      return toRemoveFollowOutcome(await api.channelFollowInteraction.RemoveFollow(spaceId, channelId, followId));
    } catch (e) {
      logger.error("[ChannelFollow] RemoveFollow failed", e);
      return { ok: false, errorKey: removeFollowErrorKey(RemoveFollowError.NONE) };
    }
  }

  return { follow, publish, followers, followedSources, removeFollow };
}

/** "Publish to followers" from a message list: the call, the toast, and the local stamp on success. */
export function usePublishToFollowers(
  where: () => { spaceId: string | null | undefined; channelId: string },
  onPublished: (messageId: bigint, publishedAt: IonDateTime) => unknown,
) {
  const { publish } = useChannelFollow();
  const { toast } = useToast();
  const { t } = useLocale();
  const inFlight = new Set<bigint>();

  async function publishMessage(message: Pick<ArgonMessage, "messageId">) {
    const { spaceId, channelId } = where();
    if (!spaceId || inFlight.has(message.messageId)) return;
    inFlight.add(message.messageId);
    try {
      const outcome = await publish(spaceId, channelId, message.messageId);
      if (!outcome.ok) {
        toast({ title: t("publish_failed"), description: t(outcome.errorKey), variant: "destructive" });
        return;
      }
      await onPublished(message.messageId, outcome.publishedAt);
      const description = publishSuccessDescription(outcome);
      toast({ title: t("publish_success"), description: t(description.key, description.params) });
    } finally {
      inFlight.delete(message.messageId);
    }
  }

  return { publishMessage };
}
