import { afterEach, describe, expect, test, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { isModalLayerOpen, useEscapeDismiss } from "@/lib/modalLayers";

/**
 * Pins the selector, which is the fragile half of the guard.
 *
 * The three settings windows close themselves on Escape from a `window` listener, and a dialog
 * opened inside one of them shares that key. Nothing else stops the window from closing underneath,
 * so if the attribute this looks for ever stops being rendered, the bug comes back silently — one
 * press closing two things is exactly the kind of thing nobody reports twice.
 */
afterEach(() => {
  document.body.innerHTML = "";
});

describe("modal layers", () => {
  test("nothing open is nothing open", () => {
    expect(isModalLayerOpen()).toBe(false);
  });

  test("a dialog rendered by our DialogContent counts", () => {
    document.body.innerHTML = `<div data-slot="dialog-content"></div>`;

    expect(isModalLayerOpen()).toBe(true);
  });

  test("an open alert dialog counts", () => {
    document.body.innerHTML = `<div role="alertdialog" data-state="open"></div>`;

    expect(isModalLayerOpen()).toBe(true);
  });

  test("a closed alert dialog left in the tree does not", () => {
    document.body.innerHTML = `<div role="alertdialog" data-state="closed"></div>`;

    expect(isModalLayerOpen()).toBe(false);
  });
});

describe("escape dismiss", () => {
  const Host = defineComponent({
    props: { open: { type: Boolean, required: true }, dismiss: { type: Function, required: true } },
    setup(props) {
      useEscapeDismiss(() => props.open, () => props.dismiss());
      return () => h("div");
    },
  });

  function press(): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

    window.dispatchEvent(event);
    return event;
  }

  test("an open dialog takes the key and stops it going further", () => {
    const dismiss = vi.fn();
    const seenByWindow = vi.fn();

    // Registered after the composable's capture listener, which is the position the drawer and the
    // settings window's own shortcut are in.
    window.addEventListener("keydown", seenByWindow);

    const host = mount(Host, { props: { open: true, dismiss } });

    try {
      const event = press();

      expect(dismiss).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
      expect(seenByWindow).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", seenByWindow);
      host.unmount();
    }
  });

  test("a closed dialog lets the key past", () => {
    const dismiss = vi.fn();
    const host = mount(Host, { props: { open: false, dismiss } });

    try {
      expect(press().defaultPrevented).toBe(false);
      expect(dismiss).not.toHaveBeenCalled();
    } finally {
      host.unmount();
    }
  });

  test("an unmounted dialog stops listening", () => {
    const dismiss = vi.fn();

    mount(Host, { props: { open: true, dismiss } }).unmount();
    press();

    expect(dismiss).not.toHaveBeenCalled();
  });
});
