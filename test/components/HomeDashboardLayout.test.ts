import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { shallowMount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { displayName: "Me" } }) }));
vi.mock("@/components/home/widgets/ActiveNowWidget.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/home/widgets/RecentSpacesWidget.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/home/widgets/DailyStatsWidget.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/home/widgets/LevelWidget.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/home/widgets/QuickJoinWidget.vue", () => ({ default: { render: () => null } }));

import HomeDashboard from "@/components/home/views/HomeDashboard.vue";
import { useWidgetStore, type WidgetLayout } from "@/store/ui/widgetStore";

let wrapper: VueWrapper | null = null;
beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => wrapper?.unmount());

test("completed lg edits survive reloading the store; responsive and initial layouts are not persisted", async () => {
  const store = useWidgetStore();
  wrapper = shallowMount(HomeDashboard);
  const grid = wrapper.getComponent({ name: "GridLayout" });
  grid.vm.$emit("layout-updated", store.layout);
  expect(localStorage.getItem("dashboard-layout")).toBeNull();

  store.toggleEditMode();
  const edited: WidgetLayout[] = store.layout.map((item) => ({ ...item, y: item.y + 2 }));
  grid.vm.$emit("update:layout", edited);
  grid.vm.$emit("layout-updated", edited);
  await nextTick();
  expect(JSON.parse(localStorage.getItem("dashboard-layout")!)).toEqual(edited);

  for (const breakpoint of ["md", "sm", "xs", "xxs"]) {
    const narrow = edited.map((item) => ({ ...item, x: 0 }));
    grid.vm.$emit("breakpoint-changed", breakpoint);
    grid.vm.$emit("update:layout", narrow);
    grid.vm.$emit("layout-updated", narrow);
    await nextTick();
    expect(store.layout).toEqual(edited);
    expect(JSON.parse(localStorage.getItem("dashboard-layout")!)).toEqual(edited);
  }

  store.loadLayout();
  expect(store.layout).toEqual(edited);
});
