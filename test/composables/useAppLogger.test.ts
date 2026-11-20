import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { expect, it, vi } from "vitest";
import { logger } from "@argon/core";
import { useAppLogger } from "@/composables/useAppLogger";

it("keeps recent client and runtime errors available before diagnostics is opened", () => {
  const add = vi.spyOn(logger, "addReporter").mockReturnValue(logger);
  const remove = vi.spyOn(logger, "removeReporter").mockReturnValue(logger);
  const wrapper = mount(defineComponent({
    setup() {
      const entries = useAppLogger();
      return { entries };
    },
    render: () => h("div"),
  }));
  try {
    const reporter = add.mock.calls[0]![0];
    for (let i = 0; i < 22; i++) {
      window.dispatchEvent(new ErrorEvent("error", { message: `Runtime ${i}` }));
    }
    reporter.log({ type: "error", level: 0, tag: "", date: new Date(), args: ["Camera", new Error("device failed")] }, { options: logger.options });
    expect(wrapper.vm.entries).toHaveLength(20);
    expect(wrapper.vm.entries[0]?.message).toBe("Camera device failed");
    expect(wrapper.vm.entries[1]?.message).toBe("Runtime 21");
    wrapper.unmount();
    expect(remove).toHaveBeenCalledWith(reporter);
    window.dispatchEvent(new ErrorEvent("error", { message: "after unmount" }));
    expect(wrapper.vm.entries[0]?.message).toBe("Camera device failed");
  } finally {
    vi.restoreAllMocks();
  }
});
