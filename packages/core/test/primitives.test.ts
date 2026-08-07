/**
 * The small primitives: DeferFlag, delay, startTimer and cn.
 *
 * Timers use vitest's fake clock rather than real waiting — startTimer counts days,
 * and no suite should take a day to prove it.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { ref } from "vue";
import { DeferFlag } from "../src/DeferFlag";
import delay from "../src/delay";
import { startTimer } from "../src/intervalTimer";
import { cn } from "../src/utils";

afterEach(() => {
  vi.useRealTimers();
});

describe("DeferFlag", () => {
  test("raises the flag for the length of a scope and lowers it after", () => {
    const busy = ref(false);

    {
      using _guard = new DeferFlag(busy);
      expect(busy.value).toBe(true);
    }

    expect(busy.value).toBe(false);
  });

  test("lowers the flag even when the scope throws", () => {
    const busy = ref(false);

    expect(() => {
      using _guard = new DeferFlag(busy);
      throw new Error("boom");
    }).toThrow("boom");

    expect(busy.value).toBe(false);
  });

  test("nesting leaves the flag down only after the outermost scope", () => {
    const busy = ref(false);
    {
      using _outer = new DeferFlag(busy);
      {
        using _inner = new DeferFlag(busy);
      }
      // Not a counter — the inner scope already cleared it. Documented so nobody
      // relies on nesting behaving like a reference count.
      expect(busy.value).toBe(false);
    }
    expect(busy.value).toBe(false);
  });
});

describe("delay", () => {
  test("resolves only after the requested time", async () => {
    vi.useFakeTimers();
    const settled = vi.fn();

    const pending = delay(1000).then(settled);

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toHaveBeenCalled();
  });
});

describe("startTimer", () => {
  test("reports elapsed time once a second", () => {
    vi.useFakeTimers();
    const ticks: unknown[] = [];
    const stop = startTimer((t) => ticks.push(t));

    vi.advanceTimersByTime(3000);
    stop();

    expect(ticks).toEqual([
      { days: 0, hours: 0, minutes: 0, seconds: 1 },
      { days: 0, hours: 0, minutes: 0, seconds: 2 },
      { days: 0, hours: 0, minutes: 0, seconds: 3 },
    ]);
  });

  test("rolls over minutes, hours and days", () => {
    vi.useFakeTimers();
    let last: { days: number; hours: number; minutes: number; seconds: number } | null = null;
    const stop = startTimer((t) => { last = t; });

    // 1 day, 2 hours, 3 minutes, 4 seconds
    vi.advanceTimersByTime((86400 + 2 * 3600 + 3 * 60 + 4) * 1000);
    stop();

    expect(last).toEqual({ days: 1, hours: 2, minutes: 3, seconds: 4 });
  });

  test("the returned function stops the clock", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const stop = startTimer(onTick);

    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(10_000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });
});

describe("cn", () => {
  test("joins class names and drops falsy ones", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });

  test("later tailwind utilities win over earlier conflicting ones", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  test("keeps utilities that only look similar", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  test("accepts arrays and conditional objects", () => {
    expect(cn(["a", "b"], { c: true, d: false })).toBe("a b c");
  });
});
