import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  ConfigValueType,
  type ConfigSection,
  type ConfigKey,
  type ConfigUpdate,
} from "@/lib/shell/configTypes";
import { desktopConfig } from "@/lib/shell/desktop";
import { isDesktop } from "@/lib/platform";

export const useConfigStore = defineStore("nativeConfig", () => {
  const sections = ref<ConfigSection[]>([]);
  const requiresRestart = ref(new Set<string>());
  const devModeEnabled = ref(false);
  const loaded = ref(false);

  const flatKeys = computed(() => {
    const map = new Map<string, ConfigKey>();
    for (const section of sections.value) {
      for (const key of section.keys) {
        map.set(`${section.section}:${key.key}`, key);
      }
    }
    return map;
  });

  const getKey = (section: string, key: string) =>
    flatKeys.value.get(`${section}:${key}`);

  const enableDevMode = async () => {
    await setValue_raw({
      key: "DevMode",
      section: "app",
      valueB: true,
      valueEnum: null,
      valueNum: null,
      valueStr: null,
      valueF: null,
    });
    await load();
  };

  const setTheme = async (theme: "Dark" | "White" | "OLED" | "System") => {
    if (isDesktop)
      await setValue_raw({
        key: "Theme",
        section: "appearance",
        valueB: null,
        valueEnum: null,
        valueNum: null,
        valueStr: theme, // Theme is a String config key
        valueF: null,
      });
  };

  const setWindowMaterial = async (material: string) => {
    if (isDesktop)
      await setValue_raw({
        key: "WindowMaterial",
        section: "appearance",
        valueB: null,
        valueEnum: material,
        valueNum: null,
        valueStr: null,
        valueF: null,
      });
  };

  const load = async () => {
    if (!isDesktop) {
      loaded.value = true;
      return;
    }
    // @ts-ignore
    const raw = await desktopConfig.read();

    // DevMode
    for (const section of raw) {
      for (const key of section.keys) {
        if (key.key === "DevMode" && key.type === ConfigValueType.Boolean) {
          devModeEnabled.value = key.valueB === true;
        }
      }
    }

    sections.value = raw
      .map((section) => ({
        ...section,
        keys: section.keys.filter((k) => {
          if (k.onlyForDevMode && !devModeEnabled.value) return false;
          return true;
        }),
      }))
      .filter((s) => s.keys.length > 0);

    loaded.value = true;
  };

  const setValue_raw = async (req: ConfigUpdate) => {
    // @ts-ignore
    const updated = await desktopConfig.update(req);
    if (!updated?.value) {
      throw new Error("Config update failed");
    }

    return updated.value;
  };

  const setValue = async (
    section: string,
    key: ConfigKey,
    value: any
  ) => {
    const req: ConfigUpdate = {
      section,
      key: key.key,
      valueB: null,
      valueStr: null,
      valueNum: null,
      valueEnum: null,
      valueF: null,
    };

    switch (key.type) {
      case ConfigValueType.Boolean:
        req.valueB = value;
        break;
      case ConfigValueType.String:
        req.valueStr = value;
        break;
      case ConfigValueType.Number:
        req.valueNum = value;
        break;
      case ConfigValueType.Enum:
        req.valueEnum = value;
        break;
      case ConfigValueType.Double:
        req.valueF = value;
        break;
    }

    // @ts-ignore
    const updated = await desktopConfig.update(req);
    if (!updated?.value) {
      throw new Error("Config update failed");
    }

    Object.assign(key, updated.value);

    if (key.requiredToRestartApp) {
      requiresRestart.value.add(`${section}:${key.key}`);
    }

    if (key.key === "DevMode") {
      await load();
    }

    return updated.value;
  };

  return {
    sections,
    requiresRestart,
    devModeEnabled,
    loaded,
    enableDevMode,
    load,
    setValue,
    getKey,
    setTheme,
    setWindowMaterial,
  };
});
