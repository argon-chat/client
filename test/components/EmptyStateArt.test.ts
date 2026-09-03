/**
 * The artwork has to follow the in-app "reduce motion" switch while it is on screen.
 *
 * The regression this guards: the component used to call `persistedValue()` for itself.
 * That helper builds a *new* ref per call — both refs read the same key, neither sees the
 * other's writes — so flipping the switch in Appearance settings left every mounted piece
 * of artwork animating until it happened to be re-created.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";

import EmptyStateArt from "@/components/shared/EmptyStateArt.vue";
import { reduceMotion } from "@/composables/useReducedMotion";
import noMessages from "@/styles/empty-states/no-messages.svg?raw";

describe("EmptyStateArt", () => {
  beforeEach(() => {
    reduceMotion.value = false;
  });

  test("takes the reduce-motion class as the preference changes under it", async () => {
    const wrapper = mount(EmptyStateArt, { props: { name: "no-messages" } });

    expect(wrapper.classes()).not.toContain("es-art--still");

    reduceMotion.value = true;
    await nextTick();
    expect(wrapper.classes()).toContain("es-art--still");

    reduceMotion.value = false;
    await nextTick();
    expect(wrapper.classes()).not.toContain("es-art--still");
  });

  test("starts still when the preference is already on", () => {
    reduceMotion.value = true;

    const wrapper = mount(EmptyStateArt, { props: { name: "no-friends-sad" } });

    expect(wrapper.classes()).toContain("es-art--still");
  });

  test("inlines the artwork at the requested size", () => {
    const wrapper = mount(EmptyStateArt, { props: { name: "no-messages", size: 96 } });

    expect(wrapper.find("svg.es-svg").exists()).toBe(true);
    expect(wrapper.attributes("style")).toContain("96px");
  });

  // Asserted against the file rather than the rendered tree: happy-dom's innerHTML parser drops
  // most of an inlined SVG, and these are properties of what scripts/theme-empty-states.ts emits.
  test("the artwork files are themed and scoped", () => {
    expect(noMessages).toContain('class="es-svg"');
    // Colours go through a custom property, with the original hex as the standalone fallback.
    expect(noMessages).toContain("var(--es-accent,#a78bfa)");
    // A <style> inside an inlined SVG applies to the whole document, so nothing in it may be
    // written in terms the rest of the app could match.
    expect(noMessages).not.toMatch(/^\.(?!es-svg )/m);
    expect(noMessages).not.toMatch(/@keyframes (?!es-)/);
  });
});
