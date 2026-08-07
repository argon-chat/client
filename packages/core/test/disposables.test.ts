/**
 * Disposable and DisposableBag.
 *
 * These sit under every subscription and audio node in the app — the call manager
 * clears its whole per-call state through a bag — so their failure modes matter more
 * than their happy path. The interesting cases here are what happens when one member
 * of a bag misbehaves, and whether a bag is safe to reuse afterwards.
 */

import { describe, test, expect, vi } from "vitest";
import { Subject, Subscription } from "rxjs";
import { Disposable, DisposableBag } from "../src/disposables";

const disposable = <T>(value: T, onDestroy = async () => {}) =>
  new Disposable(value, onDestroy);

describe("Disposable", () => {
  test("hands out its value until disposed, then refuses", () => {
    const d = disposable({ id: 1 });
    expect(d.Value).toEqual({ id: 1 });

    d.dispose();

    expect(d.disposed).toBe(true);
    expect(() => d.Value).toThrow(/disposed/);
  });

  test("runs the destructor exactly once", () => {
    const onDestroy = vi.fn(async () => {});
    const d = disposable("x", onDestroy);

    d.dispose();
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(onDestroy).toHaveBeenCalledWith("x");

    expect(() => d.dispose()).toThrow(/already/);
    expect(onDestroy).toHaveBeenCalledTimes(1);
  });

  test("asyncDispose awaits the destructor", async () => {
    let finished = false;
    const d = disposable("x", async () => {
      await new Promise((r) => setTimeout(r, 5));
      finished = true;
    });

    await d.asyncDispose();
    expect(finished).toBe(true);
  });

  test("works with `using` through the disposal protocol", () => {
    const onDestroy = vi.fn(async () => {});
    const d = disposable("x", onDestroy);

    d[Symbol.dispose]();

    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(d.disposed).toBe(true);
  });

  test("injectInto hands back the value and enrols in the bag", () => {
    const bag = new DisposableBag();
    const onDestroy = vi.fn(async () => {});

    const value = disposable({ node: "gain" }, onDestroy).injectInto(bag);
    expect(value).toEqual({ node: "gain" });

    bag.dispose();
    expect(onDestroy).toHaveBeenCalledTimes(1);
  });

  test("a disposed object cannot be enrolled", () => {
    const d = disposable("x");
    d.dispose();
    expect(() => d.injectInto(new DisposableBag())).toThrow(/already/);
  });
});

describe("DisposableBag", () => {
  test("unsubscribes everything it holds", () => {
    const bag = new DisposableBag();
    const unsubscribed = vi.fn();
    bag.addSubscription(new Subscription(unsubscribed));

    bag.dispose();

    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });

  test("a subject added to the bag is torn down with it", () => {
    const bag = new DisposableBag();
    const subject = new Subject<number>();
    bag.addSubject(subject);

    bag.dispose();

    expect(subject.closed).toBe(true);
  });

  test("is reusable: a subscription added after dispose still gets cleaned up", () => {
    // dispose() installs a fresh Subscription precisely so the bag survives a call
    // ending and can be filled again for the next one.
    const bag = new DisposableBag();
    bag.addSubscription(new Subscription(() => {}));
    bag.dispose();

    const second = vi.fn();
    bag.addSubscription(new Subscription(second));
    bag.dispose();

    expect(second).toHaveBeenCalledTimes(1);
  });

  test("disposes every member even when one of them throws", () => {
    // A bag is a teardown mechanism; if one bad member can abort the loop, everything
    // enrolled after it silently leaks — and the bag keeps holding all of them.
    const bag = new DisposableBag();
    const after = vi.fn(async () => {});

    disposable("boom", async () => {}).injectInto(bag);
    (bag.disposers[0] as any)[Symbol.dispose] = () => {
      throw new Error("teardown failed");
    };
    disposable("ok", after).injectInto(bag);

    expect(() => bag.dispose()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(bag.disposers).toHaveLength(0);
  });

  test("asyncDispose also survives a failing member", async () => {
    const bag = new DisposableBag();
    const after = vi.fn(async () => {});

    disposable("boom", async () => {
      throw new Error("teardown failed");
    }).injectInto(bag);
    disposable("ok", after).injectInto(bag);

    await expect(bag.asyncDispose()).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
    expect(bag.disposers).toHaveLength(0);
  });

  test("an empty bag disposes cleanly and repeatedly", () => {
    const bag = new DisposableBag();
    expect(() => {
      bag.dispose();
      bag.dispose();
    }).not.toThrow();
  });
});
