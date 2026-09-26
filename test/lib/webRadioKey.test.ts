/**
 * The web build's radio key: a focused-window key that must never stay "down" once the page can
 * no longer see the key-up — losing focus, being hidden, a cancelled pointer.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const deps = vi.hoisted(() => ({
  globalHotkeys: false,
  radioWebKey: "Backquote",
  call: { radioKeyDown: vi.fn(), radioKeyUp: vi.fn() },
}));

vi.mock("@/lib/platform", () => ({ supports: () => deps.globalHotkeys }));
vi.mock("@/store/ui/hotKeyStore", () => ({
  useHotkeys: () => ({ options: { get radioWebKey() { return deps.radioWebKey; } } }),
}));
vi.mock("@/store/media/unifiedCallStore", () => ({ useUnifiedCall: () => deps.call }));

import { initWebRadioKey, isTypingTarget } from "@/lib/hotkeys/webRadioKey";

const key = (type: "keydown" | "keyup", code = "Backquote", init: KeyboardEventInit = {}, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init }));

let uninstall: () => void = () => {};

beforeEach(() => {
  deps.globalHotkeys = false;
  deps.radioWebKey = "Backquote";
  deps.call.radioKeyDown.mockClear();
  deps.call.radioKeyUp.mockClear();
});

afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
});

describe("the web radio key", () => {
  test("holds the key down once, ignoring auto-repeat, and lets go on key-up", () => {
    uninstall = initWebRadioKey();

    key("keydown");
    key("keydown", "Backquote", { repeat: true });
    key("keydown");
    expect(deps.call.radioKeyDown).toHaveBeenCalledTimes(1);

    key("keyup");
    expect(deps.call.radioKeyUp).toHaveBeenCalledTimes(1);
    key("keyup");
    expect(deps.call.radioKeyUp).toHaveBeenCalledTimes(1);
  });

  test("other keys, modifiers and typing do not transmit", () => {
    uninstall = initWebRadioKey();
    const input = document.createElement("input");
    document.body.appendChild(input);

    key("keydown", "KeyA");
    key("keydown", "Backquote", { ctrlKey: true });
    key("keydown", "Backquote", {}, input);
    expect(deps.call.radioKeyDown).not.toHaveBeenCalled();

    input.remove();
  });

  test("losing focus, hiding the tab or a cancelled pointer releases a held key", () => {
    uninstall = initWebRadioKey();

    key("keydown");
    window.dispatchEvent(new Event("blur"));
    expect(deps.call.radioKeyUp).toHaveBeenCalledTimes(1);

    key("keydown");
    window.dispatchEvent(new Event("pointercancel"));
    expect(deps.call.radioKeyUp).toHaveBeenCalledTimes(2);

    key("keydown");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(deps.call.radioKeyUp).toHaveBeenCalledTimes(3);
    expect(deps.call.radioKeyDown).toHaveBeenCalledTimes(3);
  });

  test("the key is the configured one, read live", () => {
    uninstall = initWebRadioKey();

    deps.radioWebKey = "KeyV";
    key("keydown", "Backquote");
    expect(deps.call.radioKeyDown).not.toHaveBeenCalled();
    key("keydown", "KeyV");
    expect(deps.call.radioKeyDown).toHaveBeenCalledTimes(1);
  });

  test("a key rebound while held still releases on the old key's key-up, or on blur", () => {
    uninstall = initWebRadioKey();

    key("keydown", "Backquote");
    deps.radioWebKey = "KeyV";
    key("keyup", "KeyV");
    expect(deps.call.radioKeyUp).not.toHaveBeenCalled();
    key("keyup", "Backquote");
    expect(deps.call.radioKeyUp).toHaveBeenCalledTimes(1);

    deps.radioWebKey = "Backquote";
    key("keydown", "Backquote");
    deps.radioWebKey = "KeyV";
    window.dispatchEvent(new Event("blur"));
    expect(deps.call.radioKeyUp).toHaveBeenCalledTimes(2);
    expect(deps.call.radioKeyDown).toHaveBeenCalledTimes(2);
  });

  test("the desktop build, with global hotkeys, installs nothing", () => {
    deps.globalHotkeys = true;
    uninstall = initWebRadioKey();

    key("keydown");
    expect(deps.call.radioKeyDown).not.toHaveBeenCalled();
  });

  test("typing targets", () => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
