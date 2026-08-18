/**
 * Which stream entries reach the app, and where a reconnect resumes from.
 *
 * Worth pinning because the failure is silent by construction: the event is dropped inside the
 * worker, so nothing throws, nothing logs, and the only symptom is a message that never appears —
 * on one client, once in a while. The case that used to fail is `delivers an event that arrives
 * late`: publishes are no longer ordered relative to each other, so a lower id after a higher one is
 * an ordinary event, not a duplicate.
 */

import { describe, test, expect } from "vitest";
import { DeliveryFilter, compareStreamIds } from "@/workers/streamDelivery";

describe("compareStreamIds", () => {
  test("orders by timestamp, then by sequence", () => {
    expect(compareStreamIds("100-0", "101-0")).toBeLessThan(0);
    expect(compareStreamIds("101-0", "100-9")).toBeGreaterThan(0);
    expect(compareStreamIds("100-1", "100-2")).toBeLessThan(0);
    expect(compareStreamIds("100-7", "100-7")).toBe(0);
  });

  test("compares the sequence as a number, not as text", () => {
    // The half after the dash is not zero-padded, so string order gets this backwards.
    expect(compareStreamIds("100-9", "100-10")).toBeLessThan(0);
  });
});

describe("DeliveryFilter", () => {
  test("delivers each id once", () => {
    const filter = new DeliveryFilter();

    expect(filter.accept("100-0")).toBe(true);
    expect(filter.accept("100-0")).toBe(false);
  });

  test("delivers an event that arrives late", () => {
    const filter = new DeliveryFilter();

    filter.accept("200-0");

    // Lower than the last id seen, and never delivered: an event published out of order, which the
    // old high-water gate discarded for good.
    expect(filter.accept("100-0")).toBe(true);
  });

  test("still suppresses a replayed event that already arrived live", () => {
    const filter = new DeliveryFilter();

    filter.accept("100-0");
    filter.accept("200-0");

    // What a Resume re-sends after a brief drop.
    expect(filter.accept("100-0")).toBe(false);
    expect(filter.accept("200-0")).toBe(false);
  });

  test("resumes from the highest id seen, not the last one", () => {
    const filter = new DeliveryFilter();

    filter.accept("200-0");
    filter.accept("100-0");

    // Resuming from the late arrival would ask the server to replay everything since — and the
    // dedupe window is what makes asking for the higher one safe.
    expect(filter.cursor).toBe("200-0");
  });

  test("has no cursor until something arrives", () => {
    expect(new DeliveryFilter().cursor).toBeNull();
  });

  test("forgets ids beyond its window rather than growing without bound", () => {
    const filter = new DeliveryFilter();
    const id = (n: number) => `${1000 + n}-0`;

    expect(filter.accept(id(0))).toBe(true);
    for (let n = 1; n <= DeliveryFilter.window; n++) filter.accept(id(n));

    // The oldest id has fallen out of the window, so its replay would be shown again. That is the
    // trade: a bounded filter can duplicate an event older than the window, and a session-long one
    // would leak memory for the whole run.
    expect(filter.accept(id(0))).toBe(true);
    expect(filter.accept(id(DeliveryFilter.window))).toBe(false);
  });
});
