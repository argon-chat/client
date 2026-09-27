import { computed, ref } from "vue";
import { usePoolStore } from "@/store/data/poolStore";
import {
  type ArgonMessage,
  type IMessageEntity,
  EntityType,
  type MessageEntitySystemCallStarted,
  type MessageEntitySystemCallEnded,
  type MessageEntitySystemCallTimeout,
  type MessageEntitySystemUserJoined,
} from "@argon/glue";

export const SYSTEM_USER_ID = "11111111-2222-1111-2222-111111111111";

export interface IFrag {
  entity?: IMessageEntity;
  text: string;
  /**
   * A style fragment holding custom emoji: its text cut into plain pieces and CustomEmoji pieces,
   * rendered inside the style's segment.
   */
  children?: IFrag[];
}

/** Drawn apart from the text (media above or below it), not inline. */
const BLOCK_ENTITIES = new Set<EntityType>([
  EntityType.Attachment,
  EntityType.Gif,
  EntityType.LinkPreview,
  EntityType.Sticker,
]);

/** Styles a custom emoji is drawn inside of; any other entity over one wins and its `:name:` stays text. */
const HOLDS_CUSTOM_EMOJI = new Set<EntityType>([
  EntityType.Bold,
  EntityType.Italic,
  EntityType.Underline,
  EntityType.Strikethrough,
  EntityType.Spoiler,
  EntityType.Capitalized,
]);

export function useMessageContent(message: () => ArgonMessage) {
  const pool = usePoolStore();

  // A webhook post is sent as the system user too, but it is an ordinary message with an author.
  const isSystemMessage = computed(() => message().sender === SYSTEM_USER_ID && !message().webhook);

  const systemMessageText = computed(() => {
    const msg = message();
    if (!isSystemMessage.value || !msg.entities?.length) return "";

    const entity = msg.entities[0];

    if (entity.type === EntityType.SystemCallStarted) {
      const e = entity as MessageEntitySystemCallStarted;
      const caller = pool.getUserReactive(ref(e.callerId));
      return `${caller.value?.displayName || "User"} started a call`;
    }

    if (entity.type === EntityType.SystemCallEnded) {
      const e = entity as MessageEntitySystemCallEnded;
      const duration = formatCallDuration(e.durationSeconds);
      return `Call ended • ${duration}`;
    }

    if (entity.type === EntityType.SystemCallTimeout) {
      return `Call timeout • No answer`;
    }

    if (entity.type === EntityType.SystemUserJoined) {
      const e = entity as MessageEntitySystemUserJoined;
      const user = pool.getUserReactive(ref(e.userId));
      if (e.inviterId) {
        const inviter = pool.getUserReactive(ref(e.inviterId));
        return `${user.value?.displayName || "User"} joined (invited by ${inviter.value?.displayName || "User"})`;
      }
      return `${user.value?.displayName || "User"} joined`;
    }

    return "";
  });

  return { isSystemMessage, systemMessageText };
}

export function fragmentMessageText(
  text: string,
  entities: IMessageEntity[],
): IFrag[] {
  const fragments: IFrag[] = [];
  const starts: number[] = [];
  let cursor = 0;

  // Attachments, GIFs, stickers and link cards are rendered separately, not inline. Custom emoji
  // are placed afterwards: they may sit inside a style entity (see parseMessageContent).
  const inlineEntities = (entities ?? []).filter((e) => !BLOCK_ENTITIES.has(e.type));
  const emoji = inlineEntities
    .filter((e) => e.type === EntityType.CustomEmoji && e.length > 0 && e.offset >= 0 && e.offset + e.length <= (text?.length ?? 0))
    .sort((a, b) => a.offset - b.offset);
  const sorted = inlineEntities.filter((e) => e.type !== EntityType.CustomEmoji).sort((a, b) => a.offset - b.offset);

  for (const entity of sorted) {
    const start = entity.offset;
    const end = entity.offset + entity.length;

    if (cursor < start) {
      starts.push(cursor);
      fragments.push({ text: text.slice(cursor, start) });
    }

    starts.push(start);
    fragments.push({ text: text.slice(start, end), entity });
    cursor = end;
  }

  if (cursor < (text?.length ?? 0)) {
    starts.push(cursor);
    fragments.push({ text: text.slice(cursor) });
  }

  if (!emoji.length) return fragments;

  const out: IFrag[] = [];
  fragments.forEach((frag, i) => {
    const start = starts[i];
    const end = start + frag.text.length;
    const inside = emoji.filter((e) => e.offset >= start && e.offset + e.length <= end);
    if (!inside.length) out.push(frag);
    else if (!frag.entity) out.push(...splitAroundEmoji(text, start, end, inside));
    else if (HOLDS_CUSTOM_EMOJI.has(frag.entity.type)) out.push({ ...frag, children: splitAroundEmoji(text, start, end, inside) });
    else out.push(frag);
  });
  return out;
}

function splitAroundEmoji(text: string, start: number, end: number, emoji: IMessageEntity[]): IFrag[] {
  const pieces: IFrag[] = [];
  let cursor = start;
  for (const e of emoji) {
    if (e.offset < cursor) continue;
    if (cursor < e.offset) pieces.push({ text: text.slice(cursor, e.offset) });
    pieces.push({ text: text.slice(e.offset, e.offset + e.length), entity: e });
    cursor = e.offset + e.length;
  }
  if (cursor < end) pieces.push({ text: text.slice(cursor, end) });
  return pieces;
}

function formatCallDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
