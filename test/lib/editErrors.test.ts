/**
 * Why an edit was refused, as the toast says it. An author who may no longer post in the channel
 * (left, banned, lost SendMessages) is told so, not "try again in a moment".
 */

import { describe, test, expect } from "vitest";
import { EditMessageError } from "@argon/glue";
import { editErrorKey } from "@/lib/chat/editErrors";

describe("editErrorKey", () => {
  test("each refusal has its own explanation", () => {
    expect(editErrorKey(EditMessageError.INSUFFICIENT_PERMISSIONS)).toBe("edit_error_no_permission");
    expect(editErrorKey(EditMessageError.MESSAGE_NOT_FOUND)).toBe("edit_error_not_found");
    expect(editErrorKey(EditMessageError.NOT_AUTHOR)).toBe("edit_error_not_author");
    expect(editErrorKey(EditMessageError.EMPTY_MESSAGE)).toBe("edit_error_empty");
    expect(editErrorKey(EditMessageError.MESSAGE_TOO_LONG)).toBe("edit_error_too_long");
  });

  test("anything else is the generic one", () => {
    expect(editErrorKey(EditMessageError.NONE)).toBe("edit_error_unknown");
    expect(editErrorKey(99 as EditMessageError)).toBe("edit_error_unknown");
  });
});
