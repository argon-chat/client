/**
 * Skathi's `<SkWindow>`: part of this component tree, painted by a window of its own (Skathi
 * docs/MULTIWINDOW.md). The media viewer is one (§7.9, ./viewerWindow.ts).
 *
 * The public spelling is `import { SkWindow } from "@skathi-native/runtime"`, which the Vite build has no module
 * for. A Skathi build resolves "vue" itself to the module that exports it, so it is read off
 * that namespace instead. Behind `import.meta.env.SK`, which Vite replaces with `undefined`: the
 * lookup is then dead code, and the namespace it reads is never used. A namespace read where Vite
 * keeps it would keep every export of Vue in the Electron and web bundle. There this is `null`.
 */
import * as vue from "vue";
import type { Component } from "vue";
import { isSk } from "./index";

export const SkWindow: Component | null =
  import.meta.env.SK && isSk ? ((Reflect.get(vue, "SkWindow") as Component | undefined) ?? null) : null;

/** A rectangle in a `<SkWindow>`'s own CSS px, relative to its root. */
export interface SkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a `<SkWindow>` ref exposes that the viewer uses. */
export interface SkWindowHandle {
  /** Where an element of the main window is, in this window: what a zoom out of a thumbnail starts from. */
  mapFromMain(el: unknown): SkRect | null;
}
