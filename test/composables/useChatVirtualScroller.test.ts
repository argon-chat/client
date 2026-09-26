/**
 * The chat list keeps what the user is reading in place while rows above it come and go.
 *
 * Rows now also disappear from the middle of a list — a message deleted, or a cached row the
 * server no longer has — and the one that disappears may be the very row the list anchored on.
 * The anchor is the first visible row, with the rows after it standing in: the first of them still
 * in the list holds its place on screen.
 */

import { describe, test, expect } from "vitest";
import { defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { mount } from "@vue/test-utils";
import { useChatVirtualScroller } from "@/composables/useChatVirtualScroller";

const ROW = 100;

function harness(count: number) {
  const list = shallowRef(Array.from({ length: count }, (_, i) => ({ id: String(i + 1) })));
  const box = ref<HTMLElement>();

  const List = defineComponent({
    setup() {
      const scroller = useChatVirtualScroller({
        list,
        scrollContainer: box,
        estimateHeight: () => ROW,
        getKey: (item) => item.id,
      });
      return () =>
        h("div", { ref: box }, scroller.renderedItems.value.map((v) => h("div", { key: v.key, "data-key": v.key })));
    },
  });

  const wrapper = mount(List, { attachTo: document.body });
  const el = box.value!;
  // No layout in happy-dom: the content is as tall as the rows the list holds.
  Object.defineProperty(el, "scrollHeight", { get: () => list.value.length * ROW });

  return { list, el, wrapper };
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
async function settle() {
  for (let i = 0; i < 3; i++) {
    await nextTick();
    await frame();
  }
}

async function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
  await settle();
}

/** Where a row sits in the viewport, in px from its top. */
const onScreen = (el: HTMLElement, key: string, list: { id: string }[]) =>
  list.findIndex((item) => item.id === key) * ROW - el.scrollTop;

describe("the chat list's scroll anchor", () => {
  test("a row prepended above keeps the view where it was", async () => {
    const { list, el, wrapper } = harness(30);
    await settle();
    await scrollTo(el, 1000);
    const before = onScreen(el, "12", list.value);

    list.value = [...Array.from({ length: 5 }, (_, i) => ({ id: `new${i}` })), ...list.value];
    await settle();

    expect(onScreen(el, "12", list.value)).toBe(before);
    wrapper.unmount();
  });

  test("the row it anchored on disappearing, with another above, does not move the rows after it", async () => {
    const { list, el, wrapper } = harness(30);
    await settle();
    // Row 11 is the first visible one.
    await scrollTo(el, 1000);
    const before = onScreen(el, "12", list.value);

    list.value = list.value.filter((item) => item.id !== "4" && item.id !== "11");
    await settle();

    expect(onScreen(el, "12", list.value)).toBe(before);
    wrapper.unmount();
  });
});
