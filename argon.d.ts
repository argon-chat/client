import type { ArgonShell } from "./src/lib/shell/host";
export {};
declare global {
  /** Bound directly by the native application before the client starts. Absent on the web. */
  var argon: ArgonShell;
  interface Window { argon: ArgonShell }
}
