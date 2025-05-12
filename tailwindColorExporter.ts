import { Plugin } from "vite";
import fs from "fs";
import path from "path";
import resolveConfig from "tailwindcss/resolveConfig";
/* @ts-ignore */
import tailwindConfigRaw from "./tailwind.config";
import type { Config } from "tailwindcss";

function flattenColors(obj: any): Record<string, string> {
  const result: Record<string, string> = {};

  function recurse(curr: any, prefix = "") {
    for (const key in curr) {
      const value = curr[key];
      const newPrefix = prefix ? `${prefix}-${key}` : key;

      if (typeof value === "string") {
        result[newPrefix] = value;
      } else if (typeof value === "object" && value !== null) {
        recurse(value, newPrefix);
      }
    }
  }

  recurse(obj);
  return result;
}

export function tailwindColorExporter(): Plugin {
  return {
    name: "vite-plugin-tailwind-color-exporter",
    apply: "build",
    buildStart() {
      const fullConfig = resolveConfig(tailwindConfigRaw as Config);
      const colors = fullConfig.theme?.colors;
      if (!colors) return;

      const flat = flattenColors(colors);
      const outputPath = path.resolve(
        __dirname,
        "tailwind-colors.json"
      );

      console.log(outputPath);
      fs.writeFileSync(outputPath, JSON.stringify(flat, null, 2), "utf-8");
      console.log(`[tailwind-color-exporter] Colors exported to ${outputPath}`);
    },
  };
}
