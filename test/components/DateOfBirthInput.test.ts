/**
 * The three date-of-birth boxes take a date as it is typed and refuse what can never be part of
 * one: a month of 19, a day of 00, a year that starts with 0 or 18. Overflow carries into the next
 * box the way a native date field does, a refused character never shows, and a pasted date lands in
 * all three boxes whichever way round it was written. What no single box can know — the 30th of
 * February, the age limit — is still reported once the date is complete.
 */

import { describe, test, expect, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));

import DateOfBirthInput from "@/components/login/DateOfBirthInput.vue";

function mountDob() {
  const wrapper = mount(DateOfBirthInput, { attachTo: document.body });
  const [day, month, year] = wrapper.findAll("input").map((w) => w.element) as HTMLInputElement[];
  return { wrapper, day, month, year };
}

/** Keystrokes appended to a box, one input event each, as a person typing would produce. */
async function type(el: HTMLInputElement, text: string) {
  for (const ch of text) {
    el.value += ch;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
  }
}

const lastEmitted = (wrapper: ReturnType<typeof mount>) => {
  const calls = wrapper.emitted("update:modelValue") ?? [];
  return calls[calls.length - 1]?.[0] as { toString(): string } | undefined;
};

describe("DateOfBirthInput", () => {
  test("a month of 19 is not typed: the 1 settles as January and the 9 is refused by the year", async () => {
    const { day, month, year } = mountDob();
    await type(day, "14");
    await type(month, "19");
    expect([day.value, month.value, year.value]).toEqual(["14", "01", ""]);
    expect(document.activeElement).toBe(year);
  });

  test("a day of 35 reads as the 3rd of May, and typing runs straight through to the year", async () => {
    const { day, month, year } = mountDob();
    await type(day, "35");
    expect([day.value, month.value]).toEqual(["03", "05"]);
    expect(document.activeElement).toBe(year);
  });

  test("a day that can only be a single digit is padded and moves on", async () => {
    const { day, month } = mountDob();
    await type(day, "4");
    expect(day.value).toBe("04");
    expect(document.activeElement).toBe(month);
  });

  test("00 is never a day or a month; the second zero is dropped", async () => {
    const { day, month } = mountDob();
    await type(day, "00");
    expect(day.value).toBe("0");
    await type(month, "00");
    expect(month.value).toBe("0");
  });

  test("a lone zero is cleared on the way out rather than padded to 00", async () => {
    const { wrapper, day } = mountDob();
    await type(day, "0");
    await wrapper.find("input").trigger("blur");
    expect(day.value).toBe("");
  });

  test("the year refuses any digit that cannot lead to a year between minYear and today", async () => {
    const { year } = mountDob();
    await type(year, "0");
    expect(year.value).toBe("");
    await type(year, "3");
    expect(year.value).toBe("");
    await type(year, "18");
    expect(year.value).toBe("1");
    await type(year, "998");
    expect(year.value).toBe("1998");
  });

  test("the year does not run past the current one", async () => {
    const { year } = mountDob();
    await type(year, "21");
    expect(year.value).toBe("2");
  });

  test("a letter never shows in a box, even though the ref it would clear is already empty", async () => {
    const { day } = mountDob();
    await type(day, "a");
    expect(day.value).toBe("");
  });

  test("a complete real date is emitted; an impossible one is reported instead", async () => {
    const { wrapper, day, month, year } = mountDob();
    await type(day, "14");
    await type(month, "05");
    await type(year, "1998");
    expect(lastEmitted(wrapper)?.toString()).toBe("1998-05-14");
    expect(wrapper.find("p").exists()).toBe(false);

    day.value = "30";
    month.value = "02";
    day.dispatchEvent(new Event("input"));
    month.dispatchEvent(new Event("input"));
    await nextTick();
    expect(lastEmitted(wrapper)).toBeUndefined();
    expect(wrapper.find("p").text()).toBe("dob_invalid");
  });

  test("a pasted date fills all three boxes whether written day-first or year-first", async () => {
    for (const text of ["14.05.1998", "1998-05-14"]) {
      const { wrapper, day, month, year } = mountDob();
      const clipboardData = { getData: () => text };
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      day.dispatchEvent(event);
      await nextTick();
      expect([day.value, month.value, year.value]).toEqual(["14", "05", "1998"]);
      expect(event.defaultPrevented).toBe(true);
      expect(lastEmitted(wrapper)?.toString()).toBe("1998-05-14");
      wrapper.unmount();
    }
  });

  test("eight pasted digits that make no date are left alone", async () => {
    const { day, month, year } = mountDob();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => "99/99/0000" } });
    day.dispatchEvent(event);
    await nextTick();
    expect([day.value, month.value, year.value]).toEqual(["", "", ""]);
    expect(event.defaultPrevented).toBe(true);
  });
});
