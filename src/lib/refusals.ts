import {
  ArchetypeError,
  ChannelLayoutError,
  SendMessageError,
  SpaceManageError,
  type IChannelLayoutResult,
  type ISpaceManageResult,
} from "@argon/glue";

/**
 * The i18n keys for the reasons the server gives when it refuses a call. The enums are open, so a
 * value this build does not know gets the generic message.
 */

const SEND_MESSAGE: Partial<Record<SendMessageError, string>> = {
  [SendMessageError.NO_PERMISSION]: "no_send_permission",
  [SendMessageError.NOT_TEXT_CHANNEL]: "send_error_not_text",
  [SendMessageError.BOTS_NOT_ALLOWED]: "send_error_bots_not_allowed",
  [SendMessageError.TEXT_TOO_LONG]: "send_error_too_long",
  [SendMessageError.NO_ATTACH_PERMISSION]: "send_error_no_attach_permission",
  [SendMessageError.TOO_MANY_ATTACHMENTS]: "send_error_too_many_files",
  [SendMessageError.SLOW_MODE]: "send_error_slow_mode",
  [SendMessageError.CHANNEL_CAP]: "send_error_channel_busy",
  [SendMessageError.INVALID_DATA]: "send_error_invalid",
};

const CHANNEL_LAYOUT: Partial<Record<ChannelLayoutError, string>> = {
  [ChannelLayoutError.NO_PERMISSION]: "channel_error_no_permission",
  [ChannelLayoutError.NOT_FOUND]: "channel_layout_error_not_found",
  [ChannelLayoutError.INVALID_DATA]: "channel_layout_error_invalid",
};

const SPACE_MANAGE: Partial<Record<SpaceManageError, string>> = {
  [SpaceManageError.NO_PERMISSION]: "space_manage_error_no_permission",
  [SpaceManageError.NOT_FOUND]: "space_manage_error_not_found",
  [SpaceManageError.INVALID_DATA]: "space_manage_error_invalid",
  [SpaceManageError.CONTENT_REJECTED]: "space_manage_error_content_rejected",
};

const ARCHETYPE: Partial<Record<ArchetypeError, string>> = {
  [ArchetypeError.NO_PERMISSION]: "archetype_error_no_permission",
  [ArchetypeError.IS_DEFAULT]: "archetype_error_locked",
  [ArchetypeError.IS_LOCKED]: "archetype_error_locked",
  [ArchetypeError.INVALID_DATA]: "archetype_error_invalid",
};

export function sendMessageErrorKey(error: SendMessageError): string {
  return SEND_MESSAGE[error] ?? "send_error_unknown";
}

export function channelLayoutErrorKey(error: ChannelLayoutError): string {
  return CHANNEL_LAYOUT[error] ?? "channel_layout_error_unknown";
}

export function spaceManageErrorKey(error: SpaceManageError): string {
  return SPACE_MANAGE[error] ?? "space_manage_error_unknown";
}

export function archetypeErrorKey(error: ArchetypeError): string {
  return ARCHETYPE[error] ?? "archetype_error_unknown";
}

/** Why a channel layout change was refused, or null when it was applied. */
export function channelLayoutRefusal(result: IChannelLayoutResult): ChannelLayoutError | null {
  // Failed first: an empty Success case is structurally the base type, so its guard narrows the rest to never.
  if (result.isFailedChannelLayout()) return result.error;
  return result.isSuccessChannelLayout() ? null : ChannelLayoutError.NONE;
}

/** Why a space management call was refused, or null when it was applied. */
export function spaceManageRefusal(result: ISpaceManageResult): SpaceManageError | null {
  if (result.isFailedSpaceManage()) return result.error;
  return result.isSuccessSpaceManage() ? null : SpaceManageError.NONE;
}
