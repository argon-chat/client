/** Which dropped files the sticker workbench can take, and what it hands back. */

import { describe, test, expect } from "vitest";
import { ExpressionKind } from "@argon/glue";
import { editedFileName, isFixableInWorkbench, isWorkbenchImage, workbenchModeFor } from "@/lib/expressions/workbench/entry";

const file = (name: string, type: string) => ({ name, type });

describe("isWorkbenchImage", () => {
  test("PNG and WEBP, and the photo formats the workbench converts", () => {
    expect(isWorkbenchImage(file("a.png", "image/png"))).toBe(true);
    expect(isWorkbenchImage(file("a.webp", "image/webp"))).toBe(true);
    expect(isWorkbenchImage(file("a.jpg", "image/jpeg"))).toBe(true);
  });

  test("not animations or video", () => {
    expect(isWorkbenchImage(file("a.tgs", "application/x-tgsticker"))).toBe(false);
    expect(isWorkbenchImage(file("a.json", "application/json"))).toBe(false);
    expect(isWorkbenchImage(file("a.webm", "video/webm"))).toBe(false);
  });

  test("an untyped file (some drops) goes by its extension", () => {
    expect(isWorkbenchImage(file("Face.PNG", ""))).toBe(true);
    expect(isWorkbenchImage(file("face.tgs", ""))).toBe(false);
  });
});

describe("isFixableInWorkbench", () => {
  test("canvas, size, type and animation refusals of an image are fixable", () => {
    const png = file("a.png", "image/png");
    expect(isFixableInWorkbench(png, "expression_settings_upload_error_dims_emoji")).toBe(true);
    expect(isFixableInWorkbench(png, "expression_settings_upload_error_dims_sticker")).toBe(true);
    expect(isFixableInWorkbench(png, "expression_settings_upload_error_size")).toBe(true);
    expect(isFixableInWorkbench(file("a.jpg", "image/jpeg"), "expression_settings_upload_error_type")).toBe(true);
    expect(isFixableInWorkbench(png, "expression_settings_upload_error_animated_image")).toBe(true);
  });

  test("a broken file, or anything that is not an image, is not", () => {
    expect(isFixableInWorkbench(file("a.png", "image/png"), "expression_settings_upload_error_corrupt")).toBe(false);
    expect(isFixableInWorkbench(file("a.tgs", "application/x-tgsticker"), "expression_settings_upload_error_size")).toBe(false);
  });
});

describe("the edited file", () => {
  test("keeps the base name, takes the new type's extension", () => {
    expect(editedFileName("Tiny Face.png", "image/webp")).toBe("Tiny Face.webp");
    expect(editedFileName("cat.photo.jpg", "image/png")).toBe("cat.photo.png");
    expect(editedFileName("noext", "image/webp")).toBe("noext.webp");
    expect(editedFileName(".png", "image/webp")).toBe("sticker.webp");
  });

  test("the mode follows the pack's kind", () => {
    expect(workbenchModeFor(ExpressionKind.Emoji)).toBe("emoji");
    expect(workbenchModeFor(ExpressionKind.Sticker)).toBe("sticker");
  });
});
