/**
 * vue-native's `<VnWindow>`: part of this component tree, painted by a window of its own (vue-native
 * docs/MULTIWINDOW.md). The media viewer is one (§7.9, ./viewerWindow.ts).
 *
 * The public spelling is `import { VnWindow } from "vue-native"`, which the Vite build has no module
 * for. A vue-native build resolves "vue" itself to the module that exports it, so it is read off
 * that namespace instead. Behind `import.meta.env.VN`, which Vite replaces with `undefined`: the
 * lookup is then dead code, and the namespace it reads is never used. A namespace read where Vite
 * keeps it would keep every export of Vue in the Electron and web bundle. There this is `null`.
 */
import * as vue from "vue";
import type { Component } from "vue";
import { isVn } from "./index";

export const VnWindow: Component | null =
  import.meta.env.VN && isVn ? ((Reflect.get(vue, "VnWindow") as Component | undefined) ?? null) : null;

/** A rectangle in a `<VnWindow>`'s own CSS px, relative to its root. */
export interface VnRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a `<VnWindow>` ref exposes that the viewer uses. */
export interface VnWindowHandle {
  /** Where an element of the main window is, in this window: what a zoom out of a thumbnail starts from. */
  mapFromMain(el: unknown): VnRect | null;
}
