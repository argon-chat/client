/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * `true` in every Skathi build, undefined under Vite (Skathi docs/PACKAGING.md). A branch
   * `if (!import.meta.env.SK) { … import("…") … }` and what it imports are left out of a Skathi
   * build.
   */
  readonly SK?: boolean;
  /** Set when the desktop host only provides native codecs. */
  readonly ARGON_NO_WASM?: boolean;
  /** Set when the Windows client is compiled to a native application image. */
  readonly ARGON_NATIVE_AOT?: boolean;
}
