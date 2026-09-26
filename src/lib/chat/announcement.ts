/**
 * Announcement channels: how a post is presented (card, cover, "Read more", post as space) and how
 * long it may be. Pure functions, so the decisions are testable without mounting a message.
 */

import {
  ArgonEntitlement,
  EntityType,
  type AnnouncementSettings,
  type ChannelEntitlementOverwrite,
  type IMessageEntity,
  type MessageEntityAttachment,
} from "@argon/glue";

/** What an announcement channel without stored settings behaves like; the server's defaults. */
export const DEFAULT_ANNOUNCEMENT_SETTINGS: Readonly<AnnouncementSettings> = Object.freeze({
  reactions: true,
  postAsSpace: false,
  showAuthor: true,
});

/** A post longer than this, in characters or in lines, starts collapsed behind "Read more". */
export const COLLAPSE_CHARS = 800;
export const COLLAPSE_LINES = 12;

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

export function shouldCollapse(text: string | null | undefined): boolean {
  if (!text) return false;
  if (text.length > COLLAPSE_CHARS) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++lines > COLLAPSE_LINES) return true;
  }
  return false;
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

export function isImageAttachment(a: MessageEntityAttachment): boolean {
  if (a.contentType?.startsWith("image/")) return true;
  const ext = a.fileName?.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.includes(ext);
}

export interface CardMedia {
  /** The first image, shown full width above the text. */
  cover: MessageEntityAttachment | null;
  /** The other images, rendered as a grid the way chat messages render them. */
  images: MessageEntityAttachment[];
  files: MessageEntityAttachment[];
}

/** Splits a post's attachments into the cover, the remaining images and the files, keeping their order. */
export function cardMedia(entities: readonly IMessageEntity[] | null | undefined): CardMedia {
  const attachments = (entities ?? []).filter(
    (e): e is MessageEntityAttachment => e.type === EntityType.Attachment,
  );
  const images = attachments.filter(isImageAttachment);
  return {
    cover: images[0] ?? null,
    images: images.slice(1),
    files: attachments.filter((a) => !isImageAttachment(a)),
  };
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
 * Who a post is shown under. With post as space the space's name and avatar head the card, and the
 * author only appears as a byline when show author is on; the message itself keeps its real sender.
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

/** The card's date line: the day in words and the time on the viewer's 12h/24h preference. */
export function formatCardDate(date: Date, hour12: boolean, locale?: string): string {
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(date);
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, "0");
  const time = hour12 ? `${h % 12 || 12}:${m} ${h >= 12 ? "PM" : "AM"}` : `${h.toString().padStart(2, "0")}:${m}`;
  return `${day} · ${time}`;
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
