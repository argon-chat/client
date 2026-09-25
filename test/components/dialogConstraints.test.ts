/**
 * Dialogs cannot stretch to the screen.
 *
 * The delete-channel confirmation filled the window: the shared DialogContent had `w-full` and a
 * max width of "viewport minus 2rem", so any dialog without a width class of its own was as wide as
 * the screen. The primitive now centres the content in a padded frame, caps it at max-w-lg by
 * default, and holds it inside the frame with inline styles no class can beat, dropping the classes
 * that would stretch it. What these pin: the structure and the defaults, that stray stretch classes
 * and inline styles lose, that a deliberate widening still works, the delete-channel dialog itself,
 * and that no dialog in the app asks for a stretch class in its template.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";

const h2 = await vi.hoisted(async () => {
  const { vi } = await import("vitest");
  return {
    permissions: new Set<string>(["ManageChannels"]),
    deleteChannel: vi.fn(async () => {}),
  };
});

vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({ channelInteraction: {} }) }));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string) => k }),
}));
vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({
    has: (p: string) => h2.permissions.has(p),
    hasIn: (_c: string, p: string) => h2.permissions.has(p),
  }),
}));
vi.mock("@/store/data/channelStore", () => ({ useChannelStore: () => ({ trackChannel: async () => {} }) }));
vi.mock("@/store/data/serverStore", () => ({ useSpaceStore: () => ({ deleteChannel: h2.deleteChannel }) }));
vi.mock("@/store/ui/windowStore", () => ({ useWindow: () => ({ closeChannelSettings() {} }) }));

import { Dialog, DialogContent, DialogScrollContent, DialogTitle, isStretchUtility } from "@argon/ui/dialog";
import { ChannelType } from "@argon/glue";
import ChannelOverview from "@/components/settings/channels/ChannelOverview.vue";

let mounted: VueWrapper[] = [];
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const w of mounted) w.unmount();
  mounted = [];
  document.body.innerHTML = "";
});

function openDialog(contentProps: Record<string, unknown> = {}, content: unknown = DialogContent) {
  const Harness = defineComponent({
    setup: () => () =>
      h(Dialog, { open: true }, {
        default: () => h(content as any, contentProps, {
          default: () => [h(DialogTitle, () => "Title"), h("p", "Body")],
        }),
      }),
  });
  const w = mount(Harness, { attachTo: document.body });
  mounted.push(w);
  return w;
}

const contentEl = () => document.body.querySelector<HTMLElement>('[role="dialog"]')!;
const frameEl = () => document.body.querySelector<HTMLElement>('[data-slot="dialog-frame"]')!;
const classesOf = (el: HTMLElement) => [...el.classList];

describe("the primitive", () => {
  test("centres the content in a padded frame that covers the viewport", async () => {
    openDialog();
    await nextTick();

    const frame = frameEl();
    expect(frame).not.toBeNull();
    expect(classesOf(frame)).toEqual(expect.arrayContaining(["fixed", "inset-0", "flex", "items-center", "justify-center", "p-4"]));
    expect(frame.contains(contentEl())).toBe(true);
  });

  test("caps the width at max-w-lg by default and scrolls inside when tall", async () => {
    openDialog();
    await nextTick();

    const el = contentEl();
    expect(classesOf(el)).toEqual(expect.arrayContaining(["w-full", "max-w-lg", "overflow-y-auto"]));
    expect(el.style.position).toBe("relative");
    expect(el.style.minWidth).toBe("0px");
    expect(el.style.flexShrink).toBe("1");
    expect(el.style.maxHeight).toBe("100%");
  });

  test("stray stretch classes from a caller are dropped", async () => {
    openDialog({
      class: "w-screen h-screen h-full max-w-none max-w-full min-h-screen min-w-[900px] max-h-screen fixed inset-0 top-0 translate-x-[-50%] sm:w-screen !h-full size-full h-[100vh] rounded-2xl",
    });
    await nextTick();

    const classes = classesOf(contentEl());
    for (const stretched of ["w-screen", "h-screen", "h-full", "max-w-none", "max-w-full", "min-h-screen", "min-w-[900px]", "max-h-screen", "fixed", "inset-0", "top-0", "translate-x-[-50%]", "sm:w-screen", "!h-full", "size-full", "h-[100vh]"])
      expect(classes).not.toContain(stretched);
    // The default cap survives, and harmless classes pass through.
    expect(classes).toContain("max-w-lg");
    expect(classes).toContain("rounded-2xl");
    expect(warn).toHaveBeenCalled();
  });

  test("inline styles from a caller cannot pull it out of the frame", async () => {
    openDialog({ style: { position: "fixed", minWidth: "100vw", minHeight: "100vh", maxHeight: "none", flexShrink: 0, width: "600px" } });
    await nextTick();

    const el = contentEl();
    expect(el.style.position).toBe("relative");
    expect(el.style.minWidth).toBe("0px");
    expect(el.style.minHeight).toBe("0px");
    expect(el.style.maxHeight).toBe("100%");
    expect(el.style.flexShrink).toBe("1");
    // What does not fight the frame is kept: a fixed width still shrinks to it.
    expect(el.style.width).toBe("600px");
  });

  test("a deliberate widening replaces the default cap, and maxHeight can only lower the height cap", async () => {
    openDialog({ class: "max-w-3xl", maxHeight: "80vh" });
    await nextTick();

    const el = contentEl();
    expect(classesOf(el)).toContain("max-w-3xl");
    expect(classesOf(el)).not.toContain("max-w-lg");
    expect(el.style.maxHeight).toBe("min(100%, 80vh)");
  });

  test("the scrolling variant keeps the same width rules", async () => {
    openDialog({ class: "w-screen max-w-none" }, DialogScrollContent);
    await nextTick();

    const el = contentEl();
    expect(classesOf(el)).toEqual(expect.arrayContaining(["w-full", "max-w-lg"]));
    expect(classesOf(el)).not.toContain("w-screen");
    expect(el.style.minWidth).toBe("0px");
    expect(el.style.flexShrink).toBe("1");
  });
});

describe("the delete-channel confirmation", () => {
  test("opens constrained, inside the frame", async () => {
    const w = mount(ChannelOverview, {
      attachTo: document.body,
      props: {
        channel: {
          channelId: "c1",
          spaceId: "s1",
          name: "general",
          type: ChannelType.Text,
          slowModeSeconds: 0,
          bitrate: null,
        } as any,
      },
    });
    mounted.push(w);

    await w.find("button.danger-btn").trigger("click");
    await nextTick();
    await nextTick();

    const el = contentEl();
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("delete_channel_confirmation");
    expect(frameEl().contains(el)).toBe(true);
    const classes = classesOf(el);
    expect(classes).toContain("w-full");
    expect(classes.some((c) => /^(sm:)?max-w-(lg|md)$/.test(c))).toBe(true);
    expect(classes.some((c) => isStretchUtility(c))).toBe(false);
    expect(el.style.maxHeight).toBe("100%");
  });
});

describe("every dialog in the app", () => {
  test("no DialogContent template asks for a class that would stretch it", async () => {
    // Every component's source, as text (Vite reads them; no Node APIs in the app's tests).
    const sources = import.meta.glob("/src/**/*.vue", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const files = Object.keys(sources);
    const offenders: string[] = [];

    for (const file of files) {
      const source = sources[file];
      for (const tag of source.matchAll(/<Dialog(?:Scroll)?Content\b[^>]*>/g)) {
        const cls = /\sclass="([^"]*)"/.exec(tag[0])?.[1] ?? "";
        for (const token of cls.split(/\s+/).filter(Boolean))
          if (isStretchUtility(token)) offenders.push(`${file}: ${token}`);
      }
    }

    expect(files.length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
