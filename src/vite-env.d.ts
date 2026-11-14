/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * `true` in every Skathi build, undefined under Vite (Skathi docs/PACKAGING.md). A branch
   * `if (!import.meta.env.SK) { … import("…") … }` and what it imports are left out of a Skathi
   * build.
   */
  readonly SK?: boolean;
}
