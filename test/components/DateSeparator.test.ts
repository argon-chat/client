/**
 * The day a run of messages starts: "Today", "Yesterday", or the date as the locale writes it in full.
 */

import { describe, expect, test } from "vitest";
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
});
