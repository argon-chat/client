/**
 * vue-native adaptations — the `vue-native` branch.
 *
 * vue-native runs this app natively, with no Chromium: gpui draws it and JavaScriptCore runs it. It
 * says so with `window.isVn === true`, which its prelude sets before any app code runs. Every
 * adaptation asks `isVn` from here, so `git grep isVn` lists them all. Each one names the row of
 * vue-native's gap report it answers: research/reports/m26/client-gap.md §4, in the vue-native
 * repository.
 *
 * Anything but a literal `true` is a browser or Electron, and every adaptation then keeps the code it
 * replaces. Read once: the flag cannot change while the app runs.
 */
export const isVn: boolean = typeof window !== "undefined" && (window as { isVn?: unknown }).isVn === true;
