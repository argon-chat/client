/**
 * The day a run of messages starts: "Today", "Yesterday", or the date as the locale writes it in full.
 */

import { describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import DateSeparator from "@/components/chats/DateSeparator.vue";

const label = (date: Date) => mount(DateSeparator, { props: { date } }).text();

describe("DateSeparator", () => {
  test("today and yesterday by name", () => {
    const now = new Date();
    expect(label(now)).toBe("Today");
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    expect(label(yesterday)).toBe("Yesterday");
  });

  test("an older day as the locale writes it, each time", () => {
    const options: Intl.DateTimeFormatOptions = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
    for (const date of [new Date(2024, 1, 29, 9), new Date(2023, 11, 31, 23, 59), new Date(2024, 1, 29, 9)]) {
      expect(label(date)).toBe(date.toLocaleDateString(undefined, options));
    }
  });

  test("reuses the formatter until the current time zone offset changes", () => {
    const offset = vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(123);
    const DateTimeFormat = Intl.DateTimeFormat;
    const formatter = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      return new DateTimeFormat(locales, options);
    });
    try {
      const date = new Date(2024, 1, 29, 9);
      const expected = date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      expect(label(date)).toBe(expected);
      expect(label(date)).toBe(expected);
      expect(formatter).toHaveBeenCalledTimes(1);

      offset.mockReturnValue(234);
      expect(label(date)).toBe(expected);
      expect(formatter).toHaveBeenCalledTimes(2);
    } finally {
      offset.mockRestore();
      formatter.mockRestore();
    }
  });
});
