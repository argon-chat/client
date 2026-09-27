/**
 * Opening the server settings at a section (`openServerSettings(category)`): the window lands on it,
 * waits for it when the member's permissions have not shown it yet, and forgets a request it could
 * not honour once the window closes. Opened without one, it keeps its usual first section.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";

const h = await vi.hoisted(async () => {
  const { defineComponent, h: hh, reactive } = await import("vue");
  const stub = (name: string) => ({ default: defineComponent({ name, setup: () => () => hh("div", { "data-section": name }) }) });
  const passthrough = (name: string, gate = false) =>
    defineComponent({
      name,
      props: { open: { type: Boolean, default: true } },
      setup: (props, { slots }) => () => (gate && !props.open ? null : hh("div", slots.default?.())),
    });
  return { stub, passthrough, perms: reactive(new Set<string>()) };
});

vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ has: (flag: string) => h.perms.has(flag) }) }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/drawer", () => ({
  Drawer: h.passthrough("Drawer", true),
  DrawerContent: h.passthrough("DrawerContent"),
  DrawerHeader: h.passthrough("DrawerHeader"),
  DrawerTitle: h.passthrough("DrawerTitle"),
  DrawerDescription: h.passthrough("DrawerDescription"),
}));
vi.mock("@/components/settings/Invites.vue", () => h.stub("Invites"));
vi.mock("@/components/settings/spaces/RolesSettings.vue", () => h.stub("RolesSettings"));
vi.mock("@/components/settings/spaces/ServerProfile.vue", () => h.stub("ServerProfile"));
vi.mock("@/components/settings/spaces/BotsSettings.vue", () => h.stub("BotsSettings"));
vi.mock("@/components/settings/spaces/ExpressionsSettings.vue", () => h.stub("ExpressionsSettings"));
vi.mock("@/components/shared/TabTransition.vue", () => ({ default: h.passthrough("TabTransition") }));

import ServerSettingsWindow from "@/components/ServerSettingsWindow.vue";
import { useWindow } from "@/store/ui/windowStore";

const shown = (w: ReturnType<typeof mount>) => w.find("[data-section]").attributes("data-section");

beforeEach(() => {
  setActivePinia(createPinia());
  h.perms.clear();
});

describe("openServerSettings", () => {
  test("opens the window at the section asked for, then lets it go", async () => {
    h.perms.add("ManageServer");
    h.perms.add("CreateExpressions");
    const w = mount(ServerSettingsWindow);
    const windows = useWindow();

    windows.openServerSettings("expressions");
    await nextTick();
    expect(windows.serverSettingsOpen).toBe(true);
    expect(shown(w)).toBe("ExpressionsSettings");
    expect(windows.serverSettingsCategory).toBeNull();

    // The member moves on to another section; nothing pulls them back.
    await w.findAll(".nav-item")[0].trigger("click");
    expect(shown(w)).toBe("ServerProfile");
  });

  test("waits for the member's permissions to show the section", async () => {
    h.perms.add("ManageServer");
    const w = mount(ServerSettingsWindow);
    const windows = useWindow();

    windows.openServerSettings("expressions");
    await nextTick();
    expect(shown(w)).toBe("ServerProfile");
    expect(windows.serverSettingsCategory).toBe("expressions");

    h.perms.add("ManageExpressions");
    await nextTick();
    expect(shown(w)).toBe("ExpressionsSettings");
    expect(windows.serverSettingsCategory).toBeNull();
  });

  test("a request the window could not honour is dropped when it closes", async () => {
    h.perms.add("ManageServer");
    mount(ServerSettingsWindow);
    const windows = useWindow();

    windows.openServerSettings("bots");
    await nextTick();
    windows.serverSettingsOpen = false;
    await nextTick();
    expect(windows.serverSettingsCategory).toBeNull();
  });

  test("opened plainly, it keeps its first section", async () => {
    h.perms.add("ManageServer");
    h.perms.add("ManageExpressions");
    const w = mount(ServerSettingsWindow);
    const windows = useWindow();
    windows.openServerSettings();
    await nextTick();
    expect(shown(w)).toBe("ServerProfile");
  });
});
