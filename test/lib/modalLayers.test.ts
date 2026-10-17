/**
 * The settings window closes itself on Escape from a `window` listener, and a dialog opened inside it
 * may claim that key. Only dialogs that registered through useEscapeDismiss claim it, the topmost of
 * them takes one press, and every other dialog leaves the key to the window as before.
 */

import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  defineComponent,
  h,
  nextTick,
  ref,
} from "vue";
import {
  mount,
  type VueWrapper,
} from "@vue/test-utils";

import {
  isEscapeLayerOpen,
  useEscapeDismiss,
} from "@/lib/modalLayers";

const Layer = defineComponent({
  props: {
    open: { type: Boolean, required: true },
    dismiss: { type: Function, required: true },
  },
  setup(props) {
    useEscapeDismiss(() => props.open, () => props.dismiss());

    return () => h("div");
  },
});

const mounted: VueWrapper[] = [];

function mountLayer(open: boolean, dismiss: () => void = vi.fn()): VueWrapper {
  const wrapper = mount(Layer, { props: { open, dismiss } });

  mounted.push(wrapper);

  return wrapper;
}

function press(key = "Escape", target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) {
    wrapper.unmount();
  }

  document.body.innerHTML = "";
});

describe("the settings window's guard", () => {
  test("nothing open is nothing open", () => {
    expect(isEscapeLayerOpen()).toBe(false);
  });

  test("a dialog that never registered leaves Escape to the window", () => {
    document.body.innerHTML = `<div data-slot="dialog-content" data-state="open"></div>`;

    expect(isEscapeLayerOpen()).toBe(false);
  });

  test("an open registered layer claims it", () => {
    mountLayer(true);

    expect(isEscapeLayerOpen()).toBe(true);
  });

  test("a registered layer that is closed, or closing, does not", () => {
    mountLayer(false);

    expect(isEscapeLayerOpen()).toBe(false);
  });

  test("an unmounted layer stops counting", () => {
    mountLayer(true).unmount();
    mounted.length = 0;

    expect(isEscapeLayerOpen()).toBe(false);
  });

  test("the window's own handler sees the press only when no registered layer is open", async () => {
    const closeSettings = vi.fn();

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape" && !isEscapeLayerOpen()) {
        closeSettings();
      }
    }

    window.addEventListener("keydown", handleEscape);

    try {
      const layer = mountLayer(true);

      press("Escape", document.body);
      expect(closeSettings).not.toHaveBeenCalled();

      await layer.setProps({ open: false });
      press("Escape", document.body);
      expect(closeSettings).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("keydown", handleEscape);
    }
  });
});

describe("escape dismiss", () => {
  test("an open layer takes the key and stops it reaching the window's own handler", () => {
    const dismiss = vi.fn();
    const seenByWindow = vi.fn();

    window.addEventListener("keydown", seenByWindow);

    try {
      mountLayer(true, dismiss);

      const event = press();

      expect(dismiss).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
      expect(seenByWindow).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", seenByWindow);
    }
  });

  test("other keys pass", () => {
    const dismiss = vi.fn();

    mountLayer(true, dismiss);

    expect(press("Enter").defaultPrevented).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });

  test("a closed layer lets the key past", () => {
    const dismiss = vi.fn();

    mountLayer(false, dismiss);

    expect(press().defaultPrevented).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });

  test("an unmounted layer stops listening", () => {
    const dismiss = vi.fn();

    mountLayer(true, dismiss).unmount();
    mounted.length = 0;
    press();

    expect(dismiss).not.toHaveBeenCalled();
  });

  test("a press something earlier already claimed is left alone", () => {
    const dismiss = vi.fn();

    function claim(event: KeyboardEvent): void {
      event.preventDefault();
    }

    window.addEventListener("keydown", claim, true);

    try {
      mountLayer(true, dismiss);
      press();

      expect(dismiss).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", claim, true);
    }
  });
});

describe("stacked layers", () => {
  test("one press dismisses only the layer on top", () => {
    const dismissBottom = vi.fn();
    const dismissTop = vi.fn();

    mountLayer(true, dismissBottom);
    mountLayer(true, dismissTop);

    press();

    expect(dismissTop).toHaveBeenCalledOnce();
    expect(dismissBottom).not.toHaveBeenCalled();
  });

  test("the top is the layer opened last, not the one mounted last", async () => {
    const dismissFirstMounted = vi.fn();
    const dismissLastMounted = vi.fn();

    const firstMounted = mountLayer(false, dismissFirstMounted);

    mountLayer(true, dismissLastMounted);
    await firstMounted.setProps({ open: true });

    press();

    expect(dismissFirstMounted).toHaveBeenCalledOnce();
    expect(dismissLastMounted).not.toHaveBeenCalled();
  });

  test("once the top closes, the next press reaches the one beneath", async () => {
    const dismissBottom = vi.fn();
    const topOpen = ref(true);

    mountLayer(true, dismissBottom);

    const top = mount(defineComponent({
      setup() {
        useEscapeDismiss(() => topOpen.value, () => {
          topOpen.value = false;
        });

        return () => h("div");
      },
    }));

    mounted.push(top);

    press();
    await nextTick();

    expect(topOpen.value).toBe(false);
    expect(dismissBottom).not.toHaveBeenCalled();

    press();

    expect(dismissBottom).toHaveBeenCalledOnce();
  });
});
