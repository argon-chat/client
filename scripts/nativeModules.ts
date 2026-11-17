/**
 * `native:*` in the Vite and vitest builds, where no Argon executable embeds the app: each module is
 * the stand-in Skathi gives an app nothing embeds. `available` is false, every function throws and
 * `on` never fires. The export names come from src/native-modules.d.ts (`sk types --exe`).
 */
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const PREFIX = "\0native:";

function exportsOf(declarations: string, name: string): string[] {
  const start = declarations.indexOf(`declare module "native:${name}" {`);
  if (start < 0) return [];
  const end = declarations.indexOf("\n}", start);
  const body = declarations.slice(start, end < 0 ? undefined : end);
  const names = new Set<string>();
  for (const match of body.matchAll(/^\s*export function (\w+)\(/gm)) {
    const fn = match[1];
    if (fn && fn !== "on" && fn !== "off") names.add(fn);
  }
  return [...names];
}

export function nativeModules(declarationsPath: string): Plugin {
  return {
    name: "argon-native-modules",
    enforce: "pre",
    resolveId(id) {
      return id.startsWith("native:") ? PREFIX + id.slice("native:".length) : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const name = id.slice(PREFIX.length);
      const message = JSON.stringify(`native:${name} is provided by the Argon desktop app`);
      const lines = [
        "export const available = false;",
        "export function on() { return () => {}; }",
        "export function off() {}",
      ];
      for (const fn of exportsOf(readFileSync(declarationsPath, "utf8"), name)) {
        lines.push(`export function ${fn}() { throw new Error(${message}); }`);
      }
      return lines.join("\n");
    },
  };
}
