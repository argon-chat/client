/**
 * The host identity, set before anything reads it. main.ts imports this module FIRST. `@argon/glue`
 * defaults `window.ahid` to 0 (a browser tab) the moment it evaluates, and platform.ts derives
 * `isDesktop` / `isWeb` from it at module scope.
 *
 * 0x8 is the Windows desktop host (`isArgonHost_Windows`). vue-native is a desktop app, and the web
 * build is a dead end there: its sign-in redirects to `app://redpew/callback`, which nothing serves.
 * client-gap.md §4, "`window.ahid = 0x8` first in `main.ts`".
 *
 * `devolution_titlebar = 0x1` is the other flag the Electron preload sets (desktop preload.ts:279).
 * It is what makes AppShell draw AppTitlebar on the sign-in screen too. On the desktop that bar is
 * the window's only chrome, and vue-native's window is frameless in the same way (vn.config.json
 * `titleBarStyle: "hidden"`). The bar's drag region is also what retires the host's fallback
 * titlebar. client-gap/C-host-cookie.md, the `devolution_titlebar` row.
 */
import { isVn } from "./index";

if (isVn) {
  (window as { ahid?: number }).ahid = 0x8;
  (window as { devolution_titlebar?: number }).devolution_titlebar = 0x1;
}
