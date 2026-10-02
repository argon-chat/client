/**
 * The rolling counter (the call timer in the titlebar), in a real browser. Each place shows its
 * digit; a change rolls only the places that changed, as one Web Animation, the short way round
 * (9 → 0 rolls on, a 5 → 0 tie rolls back). Nothing writes to the DOM while it rolls — a per-frame
 * style write is what Sentry's replay recorder turned into a stylesheet per frame. Reduce motion
 * swaps the digit without a roll.
 */

import { describe, test, expect, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import Counter from "@/components/motionCounter/Counter.vue";
import { reduceMotion } from "@/composables/useReducedMotion";

const HEIGHT = 20;

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  reduceMotion.value = false;
});

function mountCounter(value: number): VueWrapper {
  wrapper = mount(Counter, {
    props: { value, fontSize: HEIGHT, places: [10, 1] },
    attachTo: document.body,
  });
  return wrapper;
}

/** The rolling strips, most significant place first. */
function strips(): HTMLElement[] {
  const spans = wrapper!.element.querySelectorAll("span");
  return [...new Set([...spans].map((s) => s.parentElement as HTMLElement))];
}

/** The digit sitting in a place's window once nothing is moving. */
function visible(strip: HTMLElement): string | undefined {
  const top = strip.parentElement!.getBoundingClientRect().top;
  const cell = [...strip.children].find((c) => Math.abs(c.getBoundingClientRect().top - top) < 0.5);
  return cell?.textContent ?? undefined;
}

function shown(): string {
  return strips().map(visible).join("");
}

function roll(strip: HTMLElement): [string, string] | null {
  const animations = strip.getAnimations();
  if (animations.length === 0) return null;
  expect(animations).toHaveLength(1);
  const frames = (animations[0].effect as KeyframeEffect).getKeyframes();
  return [frames[0].transform as string, frames[frames.length - 1].transform as string];
}

function cell(n: number): string {
  return `translateY(${-n * HEIGHT}px)`;
}

function finishAll(): void {
  for (const strip of strips()) for (const a of strip.getAnimations()) a.finish();
}

describe("motion counter", () => {
  test("each place shows its digit", () => {
    mountCounter(42);

    expect(shown()).toBe("42");
  });

  test("a change rolls only the changed place, without touching the DOM while it rolls", async () => {
    mountCounter(41);
    await wrapper!.setProps({ value: 42 });

    const writes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => writes.push(...records));
    observer.observe(wrapper!.element, { attributes: true, childList: true, characterData: true, subtree: true });

    await new Promise((resolve) => setTimeout(resolve, 300));
    observer.disconnect();

    expect(writes).toHaveLength(0);

    const [tens, ones] = strips();
    expect(roll(tens)).toBeNull();
    expect(roll(ones)).toEqual([cell(11), cell(12)]);
    expect(ones.getAnimations()[0].playState).toBe("running");

    finishAll();
    expect(shown()).toBe("42");
  });

  test("9 → 0 rolls on to the next ten", async () => {
    mountCounter(39);
    await wrapper!.setProps({ value: 40 });

    const [tens, ones] = strips();
    expect(roll(tens)).toEqual([cell(13), cell(14)]);
    expect(roll(ones)).toEqual([cell(19), cell(20)]);

    finishAll();
    expect(shown()).toBe("40");
  });

  test("59 → 00 rolls the tens back and the ones on", async () => {
    mountCounter(59);
    await wrapper!.setProps({ value: 0 });

    const [tens, ones] = strips();
    expect(roll(tens)).toEqual([cell(15), cell(10)]);
    expect(roll(ones)).toEqual([cell(19), cell(20)]);

    finishAll();
    expect(shown()).toBe("00");
  });

  test("with reduce motion on, the digit changes without a roll", async () => {
    reduceMotion.value = true;
    mountCounter(41);
    await wrapper!.setProps({ value: 42 });

    for (const strip of strips()) expect(strip.getAnimations()).toHaveLength(0);
    expect(shown()).toBe("42");
  });
});
