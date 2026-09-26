/**
 * Announcement channels: who a post is shown under (post as space), how long it may be and who may
 * publish. Pure functions, so the decisions are testable without mounting a message.
 */

import {
  ArgonEntitlement,
  type AnnouncementSettings,
  type ChannelEntitlementOverwrite,
} from "@argon/glue";

/** What an announcement channel without stored settings behaves like; the server's defaults. */
export const DEFAULT_ANNOUNCEMENT_SETTINGS: Readonly<AnnouncementSettings> = Object.freeze({
  reactions: true,
  postAsSpace: false,
  showAuthor: true,
});

export interface ComposerLimits {
  limit: number;
  warn: number;
  danger: number;
  /** The counter shows from here on. */
  counterFrom: number;
}

/** The composer's character limits: 2000, or 4000 with premium. */
export function composerLimits(isPremium: boolean): ComposerLimits {
  return isPremium
    ? { limit: 4000, warn: 3000, danger: 3800, counterFrom: 2000 }
    : { limit: 2000, warn: 1500, danger: 1900, counterFrom: 1000 };
}

/** The settings a channel row carries, or the defaults for an announcement channel that has none yet. */
export function announcementSettingsOf(announcement: AnnouncementSettings | null | undefined): AnnouncementSettings {
  return announcement ?? { ...DEFAULT_ANNOUNCEMENT_SETTINGS };
}

export interface CardIdentity {
  name: string;
  avatarFileId: string | null;
}

export interface CardHeader {
  /** The post is shown under the space rather than its author. */
  asSpace: boolean;
  title: string;
  avatarFileId: string | null;
  /** "by <author>" under the space's name, or null. */
  byline: string | null;
}

/**
 * Who a post is shown under. With post as space the space's name and avatar head it, and the author
 * only appears as a byline when show author is on; the message itself keeps its real sender.
 */
export function cardHeader(settings: AnnouncementSettings, author: CardIdentity, space: CardIdentity | null): CardHeader {
  if (settings.postAsSpace && space) {
    return {
      asSpace: true,
      title: space.name,
      avatarFileId: space.avatarFileId,
      byline: settings.showAuthor ? author.name : null,
    };
  }
  return { asSpace: false, title: author.name, avatarFileId: author.avatarFileId, byline: null };
}

// ── Publishers: roles with an Allow SendMessages overwrite on the channel ──

const SEND = BigInt(ArgonEntitlement.SendMessages);

/** A role overwrite that lets the role post here (and does not also deny it). */
export function isPublisherOverwrite(o: ChannelEntitlementOverwrite): boolean {
  return !!o.archetypeId && (BigInt(o.allow) & SEND) !== 0n && (BigInt(o.deny) & SEND) === 0n;
}

export function publisherRoleIds(overwrites: readonly ChannelEntitlementOverwrite[]): Set<string> {
  return new Set(overwrites.filter(isPublisherOverwrite).map((o) => o.archetypeId!));
}

export interface PublishingChange {
  allow: bigint;
  deny: bigint;
  /** Nothing is left on the overwrite: delete it rather than store an empty one. */
  remove: boolean;
}

/** The role's overwrite with SendMessages allowed (on) or no longer allowed (off); every other bit is kept. */
export function publishingChange(existing: ChannelEntitlementOverwrite | undefined, on: boolean): PublishingChange {
  const allow = existing ? BigInt(existing.allow) : 0n;
  const deny = existing ? BigInt(existing.deny) : 0n;
  const next = on
    ? { allow: allow | SEND, deny: deny & ~SEND }
    : { allow: allow & ~SEND, deny };
  return { ...next, remove: !on && !!existing && next.allow === 0n && next.deny === 0n };
}
