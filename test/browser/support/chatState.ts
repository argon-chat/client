/**
 * The world a browser chat test runs in: a channel on an in-memory server, what each message
 * carries, and how tall its row really is. Shared by the module mocks (which must not import the
 * app) and the harness (which does).
 */
import { reactive } from "vue";
import { Subject } from "rxjs";
import { IonDateTime } from "@argon-chat/ion.webcore";
import { EntityType } from "@argon/glue";

export type Kind = "text" | "image" | "file" | "link" | "gif";

export const events = {
  onNewMessageReceived: new Subject<any>(),
  onMessageUpdated: new Subject<any>(),
  onMessageDeleted: new Subject<any>(),
  onMessagePublished: new Subject<any>(),
};

export const world = {
  /** Message ids the server holds. */
  held: [] as bigint[],
  /** What a message carries beyond its text. */
  kinds: reactive(new Map<bigint, Kind>()),
  /** Media that finished loading, and the height it turned out to have. */
  loaded: reactive(new Map<bigint, number>()),
  /** Texts changed by an edit. */
  texts: reactive(new Map<bigint, string>()),
  /** How many reactions a message has. */
  reactions: reactive(new Map<bigint, number>()),
  /** Where the reader's unread line sits. */
  read: reactive({ lastReadId: null as bigint | null }),
};

export function resetWorld(held: bigint[]) {
  world.held = held;
  world.kinds.clear();
  world.loaded.clear();
  world.texts.clear();
  world.reactions.clear();
  world.read.lastReadId = null;
}

const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
export const asc = () => [...world.held].sort(cmp);
export const desc = () => asc().reverse();
export const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => BigInt(from + i));

const BASE = Date.UTC(2026, 8, 1, 8, 0, 0);
/** Seven minutes apart, so days turn every 205 messages; three authors taking turns in runs. */
export const timeOf = (id: bigint) => new Date(BASE + Number(id) * 7 * 60_000);
export const senderOf = (id: bigint) => ["u1", "u2", "u3"][Math.floor(Number(id) / 3) % 3];

function entitiesOf(kind: Kind): any[] {
  switch (kind) {
    case "image":
      return [{ type: EntityType.Attachment, fileId: "f", fileName: "photo.png", contentType: "image/png", width: 800, height: 600 }];
    case "file":
      return [{ type: EntityType.Attachment, fileId: "f", fileName: "notes.pdf", contentType: "application/pdf" }];
    case "link":
      return [{ type: EntityType.LinkPreview, url: "https://argon.gl", title: "Argon", description: "chat" }];
    case "gif":
      return [{ type: EntityType.Gif, gifId: "g", width: 300, height: 200 }];
    default:
      return [];
  }
}

export function msg(messageId: bigint, sender = senderOf(messageId)): any {
  return {
    messageId,
    channelId: "c1",
    spaceId: "s1",
    text: world.texts.get(messageId) ?? `m${messageId}`,
    entities: entitiesOf(world.kinds.get(messageId) ?? "text"),
    sender,
    replyId: null,
    timeSent: IonDateTime.fromDate(timeOf(messageId)),
    reactions: Array.from({ length: world.reactions.get(messageId) ?? 0 }, (_, i) => ({ emoji: `e${i}`, count: 1, users: [] })),
  };
}

/** Media before it loads: a placeholder of about the right size, as the app draws one. */
const PLACEHOLDER: Record<Kind, number> = { text: 0, image: 300, file: 48, link: 0, gif: 200 };

/**
 * How tall a row really is, the way MessageItem lays it out: the author's header when the row
 * starts a group, the text a line per 60 characters, media at their placeholder until loaded,
 * a line of reactions. Deliberately not the scroller's estimate.
 */
export function rowHeight(m: any, firstInGroup: boolean): number {
  const id = m.messageId as bigint;
  const kind = world.kinds.get(id) ?? "text";
  const lines = Math.max(1, Math.ceil(String(m.text ?? "").length / 60));
  const media = world.loaded.get(id) ?? PLACEHOLDER[kind];
  const reactions = (m.reactions?.length ?? 0) > 0 ? 30 : 0;
  return 8 + (firstInGroup ? HEADER : 0) + lines * 20 + media + reactions;
}

export const SEPARATOR = { date: 32, unread: 24 };
/** The author's name and avatar above the first message of a group. */
export const HEADER = 22;

export const api = {
  channelInteraction: {
    async QueryMessages(_s: string, _c: string, from: bigint | null, limit: number) {
      return desc().filter((id) => from === null || id < from).slice(0, limit).map((id) => msg(id));
    },
    async QueryMessagesAround(_s: string, _c: string, id: bigint, older: number, newer: number) {
      const before = desc().filter((x) => x <= id).slice(0, older + 1);
      const after = asc().filter((x) => x > id).slice(0, newer + 1);
      return {
        messages: [...after.slice(0, newer).reverse(), ...before.slice(0, older)].map((x) => msg(x)),
        hasOlder: before.length > older,
        hasNewer: after.length > newer,
        containsAnchor: older > 0 && before[0] === id,
      };
    },
  },
};
