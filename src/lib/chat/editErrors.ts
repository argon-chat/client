import { EditMessageError } from "@argon/glue";

/** Why an edit was refused, as the toast under "Couldn't edit the message" says it. */
export const EDIT_ERROR_KEYS: Partial<Record<EditMessageError, string>> = {
  [EditMessageError.MESSAGE_NOT_FOUND]: "edit_error_not_found",
  [EditMessageError.NOT_AUTHOR]: "edit_error_not_author",
  [EditMessageError.EMPTY_MESSAGE]: "edit_error_empty",
  [EditMessageError.MESSAGE_TOO_LONG]: "edit_error_too_long",
  // The author may no longer post in the channel (left, banned, lost SendMessages).
  [EditMessageError.INSUFFICIENT_PERMISSIONS]: "edit_error_no_permission",
};

export const editErrorKey = (error: EditMessageError) => EDIT_ERROR_KEYS[error] ?? "edit_error_unknown";
