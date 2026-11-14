/**
 * Skathi adaptations.
 *
 * Skathi runs this app natively, with no Chromium: gpui draws it and JavaScriptCore runs it. It
 * says so with `window.isSk === true`, which its prelude sets before any app code runs. Every
 * adaptation asks `isSk` from here, so `git grep isSk` lists them all. Each one names the row of
 * Skathi's gap report it answers: research/reports/m26/client-gap.md §4, in the Skathi
 * repository.
 *
 * Anything but a literal `true` is a browser or Electron, and every adaptation then keeps the code it
 * replaces. Read once: the flag cannot change while the app runs.
 */
export const isSk: boolean = import.meta.env.SK === true || (typeof window !== "undefined" && (window as { isSk?: unknown }).isSk === true);
