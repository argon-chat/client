import { expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import { Switch } from "@argon/ui/switch";

test("a switch bound with :model-value shows that value", () => {
  const wrapper = mount(Switch, { props: { modelValue: true } });
  expect(wrapper.find("button").attributes("data-state")).toBe("checked");
  wrapper.unmount();
});

test("a switch bound with :checked shows that value", () => {
  const wrapper = mount(Switch, { props: { checked: true } });
  expect(wrapper.find("button").attributes("data-state")).toBe("checked");
  wrapper.unmount();
});

test("clicking a :model-value switch asks for the other value", async () => {
  const wrapper = mount(Switch, { props: { modelValue: false } });
  await wrapper.find("button").trigger("click");
  expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([true]);
  wrapper.unmount();
});
