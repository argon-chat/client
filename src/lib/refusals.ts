import {
  ArchetypeError,
  ChannelLayoutError,
  EmailChangeError,
  ExpressionError,
  RegistrationError,
  SendMessageError,
  SpaceManageError,
  UpdateMeError,
  VerificationError,
  VerificationFactor,
  type IChannelLayoutResult,
  type IConfirmEmailChangeResult,
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

const EXPRESSION: Partial<Record<ExpressionError, string>> = {
  [ExpressionError.NOT_FOUND]: "expression_error_not_found",
  [ExpressionError.FORBIDDEN]: "expression_error_forbidden",
  [ExpressionError.QUOTA_EXCEEDED]: "expression_error_quota_exceeded",
  [ExpressionError.INVALID_FORMAT]: "expression_error_invalid_format",
  [ExpressionError.TOO_LARGE]: "expression_error_too_large",
  [ExpressionError.NAME_TAKEN]: "expression_error_name_taken",
  [ExpressionError.CONTENT_REJECTED]: "expression_error_content_rejected",
  [ExpressionError.RATE_LIMITED]: "expression_error_rate_limited",
};

const UPDATE_ME: Partial<Record<UpdateMeError, string>> = {
  [UpdateMeError.INVALID_STATUS_EMOJI]: "status_emoji_invalid",
};

const VERIFICATION: Partial<Record<VerificationError, string>> = {
  [VerificationError.FLOW_EXPIRED]: "verify_error_flow_expired",
  [VerificationError.FACTOR_NOT_ALLOWED]: "verify_error_factor_not_allowed",
  [VerificationError.INVALID_PROOF]: "verify_error_invalid_code",
  [VerificationError.CHALLENGE_REQUIRED]: "verify_error_challenge_required",
  [VerificationError.TOO_MANY_ATTEMPTS]: "verify_error_too_many_attempts",
  [VerificationError.RATE_LIMITED]: "verify_error_rate_limited",
  [VerificationError.INTERNAL_ERROR]: "verify_error_internal",
};

/** A wrong proof reads differently per factor; the codes share the default. */
const INVALID_PROOF: Partial<Record<VerificationFactor, string>> = {
  [VerificationFactor.PASSWORD]: "verify_error_invalid_password",
  [VerificationFactor.PASSKEY]: "verify_error_invalid_passkey",
};

const EMAIL_CHANGE: Partial<Record<EmailChangeError, string>> = {
  [EmailChangeError.INVALID_EMAIL]: "email_change_error_invalid_email",
  [EmailChangeError.EMAIL_ALREADY_USED]: "email_change_error_already_used",
  [EmailChangeError.INVALID_PASSWORD]: "email_change_error_invalid_password",
  [EmailChangeError.INVALID_VERIFICATION_CODE]: "email_change_error_invalid_code",
  [EmailChangeError.VERIFICATION_CODE_EXPIRED]: "email_change_error_code_expired",
  [EmailChangeError.RATE_LIMITED]: "email_change_error_rate_limited",
  [EmailChangeError.INTERNAL_ERROR]: "email_change_error_internal",
  [EmailChangeError.VERIFICATION_REQUIRED]: "email_change_error_verification_required",
};

const REGISTRATION: Partial<Record<RegistrationError, string>> = {
  [RegistrationError.EMAIL_ALREADY_REGISTERED]: "register_error_email_taken",
  [RegistrationError.USERNAME_ALREADY_TAKEN]: "register_error_username_taken",
  [RegistrationError.USERNAME_RESERVED]: "register_error_username_reserved",
  [RegistrationError.EMAIL_BANNED]: "register_error_email_banned",
  [RegistrationError.SSO_EMAILS_NOT_ALLOWED]: "register_error_sso_email",
  [RegistrationError.REGION_BANNED]: "register_error_region_banned",
};

/** A validation refusal names the field it is about; `rate_limit` is the server's marker for "slow down". */
const REGISTRATION_FIELD: Readonly<Record<string, string>> = {
  rate_limit: "register_error_rate_limited",
  email: "register_error_invalid_email",
  username: "register_error_invalid_username",
  password: "register_error_invalid_password",
  displayName: "register_error_invalid_displayName",
  birthDate: "register_error_invalid_birthDate",
  argreeTos: "register_error_invalid_argreeTos",
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

export function expressionErrorKey(error: ExpressionError): string {
  return EXPRESSION[error] ?? "expression_error_unknown";
}

export function updateMeErrorKey(error: UpdateMeError): string {
  return UPDATE_ME[error] ?? "profile_update_failed";
}

/** `factor` is the one the refused proof was for, when there was one. */
export function verificationErrorKey(error: VerificationError, factor: VerificationFactor | null = null): string {
  const perFactor = error === VerificationError.INVALID_PROOF && factor !== null ? INVALID_PROOF[factor] : undefined;
  return perFactor ?? VERIFICATION[error] ?? "verification_failed";
}

export function emailChangeErrorKey(error: EmailChangeError): string {
  return EMAIL_CHANGE[error] ?? "email_change_failed";
}

export function registrationErrorKey(error: RegistrationError, field: string | null = null): string {
  const perField = error === RegistrationError.VALIDATION_FAILED && field ? REGISTRATION_FIELD[field] : undefined;
  return perField ?? REGISTRATION[error] ?? "register_failed";
}

/** A custom emoji / sticker call the server refused; `key` is the i18n key for the reason. */
export class ExpressionRefusal extends Error {
  readonly key: string;

  constructor(readonly error: ExpressionError) {
    super(`Expression call refused: ${ExpressionError[error] ?? error}`);
    this.name = "ExpressionRefusal";
    this.key = expressionErrorKey(error);
  }
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

/** Why confirming a new email address was refused, or null when the address changed. */
export function confirmEmailChangeRefusal(result: IConfirmEmailChangeResult): EmailChangeError | null {
  if (result.isFailedConfirmEmailChange()) return result.error;
  return result.isSuccessConfirmEmailChange() ? null : EmailChangeError.NONE;
}
