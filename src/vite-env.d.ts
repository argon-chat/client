/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * `true` in every vue-native build, undefined under Vite (vue-native docs/PACKAGING.md). A branch
   * `if (!import.meta.env.VN) { … import("…") … }` and what it imports are left out of a vue-native
   * build.
   */
  readonly VN?: boolean;
}
