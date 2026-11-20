import { expect, it } from "vitest";
import { installTransactionPromise } from "@/lib/sk/aotPromise";

it("keeps the native Promise outside native AOT builds", () => {
  expect((async () => {})().constructor).toBe(globalThis.Promise);
});

it("allows Dexie to replace and restore its transaction methods on the application constructor", async () => {
  const native = globalThis.Promise;
  const host = { Promise: native };
  installTransactionPromise(host);
  expect(Object.getPrototypeOf(host.Promise)).toBe(native);
  for (const name of ["all", "allSettled", "any", "race", "resolve", "reject"] as const) {
    const original = native[name];
    expect(Object.getOwnPropertyDescriptor(host.Promise, name)).toMatchObject({
      value: original, configurable: true, writable: true, enumerable: false,
    });
    expect(Reflect.set(host.Promise, name, () => {})).toBe(true);
    expect(native[name]).toBe(original);
    expect(Reflect.set(host.Promise, name, original)).toBe(true);
  }
  const aggregate = host.Promise.all([host.Promise.resolve(1), 2]);
  expect(aggregate).toBeInstanceOf(host.Promise);
  await expect(aggregate).resolves.toEqual([1, 2]);
});
