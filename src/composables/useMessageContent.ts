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

const SYSTEM_USER_ID = "11111111-2222-1111-2222-111111111111";

export interface IFrag {
  entity?: IMessageEntity;
  text: string;
}

export function useMessageContent(message: () => ArgonMessage) {
  const pool = usePoolStore();

  const isSystemMessage = computed(() => message().sender === SYSTEM_USER_ID);

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
  let cursor = 0;

  // Filter out attachment entities — they are rendered separately, not inline
  const inlineEntities = entities.filter(
    (e) => e.type !== EntityType.Attachment,
  );

  const sorted = [...inlineEntities].sort((a, b) => a.offset - b.offset);

  for (const entity of sorted) {
    const start = entity.offset;
    const end = entity.offset + entity.length;

    if (cursor < start) {
      fragments.push({ text: text.slice(cursor, start) });
    }

    fragments.push({ text: text.slice(start, end), entity });
    cursor = end;
  }

  if (cursor < (text?.length ?? 0)) {
    fragments.push({ text: text.slice(cursor) });
  }

  return fragments;
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
