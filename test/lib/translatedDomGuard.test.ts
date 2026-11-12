/**
 * The DOM guard against browser translation, driven through a real Vue render.
 *
 * What this guards: Chrome's translator swaps text nodes for `<font>` wrappers, and Vue's next
 * insert next to such a node crashed the whole subtree (ARGON-CLIENT-36A…36G). The first case pins
 * the crash itself so the test keeps meaning something; the order matters, since the guard patches
 * `Node.prototype` for the rest of the file.
 */
import { describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { installTranslatedDomGuard } from "@/lib/shims/translatedDom";

/** What the translator does: every non-empty text node becomes `<font>` holding new text. */
function translate(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const text of texts) {
    if (!text.data.trim()) continue;
    const font = document.createElement("font");
    font.textContent = text.data.toUpperCase();
    text.replaceWith(font);
  }
}

function mountToggle() {
  const show = ref(false);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(
    defineComponent({
      setup: () => () => h("p", ["Hello ", show.value ? h("b", "!") : null, " world"]),
    }),
  );
  const errors: unknown[] = [];
  app.config.errorHandler = (e) => void errors.push(e);
  app.mount(host);
  return { show, host, errors, app };
}

describe("translated DOM guard", () => {
  it("without it, a translated page breaks the next insert", async () => {
    const { show, host, errors, app } = mountToggle();
    translate(host);
    show.value = true;
    await nextTick();
    expect(errors.length).toBeGreaterThan(0);
    app.unmount();
  });

  it("with it, the insert lands next to the translated text and later patches keep working", async () => {
    expect(installTranslatedDomGuard()).toBe(true);
    expect(installTranslatedDomGuard()).toBe(false);

    const { show, host, errors, app } = mountToggle();
    translate(host);
    show.value = true;
    await nextTick();
    expect(errors).toEqual([]);
    expect(host.querySelector("b")?.textContent).toBe("!");

    show.value = false;
    await nextTick();
    expect(errors).toEqual([]);
    expect(host.querySelector("b")).toBeNull();
    app.unmount();
  });

  it("leaves ordinary DOM calls alone", () => {
    const parent = document.createElement("div");
    const a = parent.appendChild(document.createElement("i"));
    const b = document.createElement("u");
    parent.insertBefore(b, a);
    expect([...parent.childNodes]).toEqual([b, a]);
    expect(parent.removeChild(a)).toBe(a);
    expect([...parent.childNodes]).toEqual([b]);
  });
});
