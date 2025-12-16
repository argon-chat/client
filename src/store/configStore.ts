import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  ConfigPrimitiveType,
  type ConfigSectionMetadata_Value,
  type ConfigKeyMetadata_Value,
  type SetRequest,
} from "@/lib/glue/argon.ipc";
import { native } from "@/lib/glue/nativeGlue";

export const useConfigStore = defineStore("nativeConfig", () => {
  const sections = ref<ConfigSectionMetadata_Value[]>([]);
  const requiresRestart = ref(new Set<string>());
  const devModeEnabled = ref(false);
  const loaded = ref(false);

  const flatKeys = computed(() => {
    const map = new Map<string, ConfigKeyMetadata_Value>();
    for (const section of sections.value) {
      for (const key of section.keys) {
        map.set(`${section.section}:${key.key}`, key);
      }
    }
    return map;
  });

  const getKey = (section: string, key: string) =>
    flatKeys.value.get(`${section}:${key}`);

  const load = async () => {
    if (!argon.isArgonHost) {
      loaded.value = true;
      return;
    }

    const raw = await native.hostProc.getConfig();

    // DevMode
    for (const section of raw) {
      for (const key of section.keys) {
        if (key.key === "DevMode" && key.type === ConfigPrimitiveType.Boolean) {
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

  const setValue = async (
    section: string,
    key: ConfigKeyMetadata_Value,
    value: any
  ) => {
    const req: SetRequest = {
      section,
      key: key.key,
      valueB: null,
      valueStr: null,
      valueNum: null,
      valueEnum: null,
    };

    switch (key.type) {
      case ConfigPrimitiveType.Boolean:
        req.valueB = value;
        break;
      case ConfigPrimitiveType.String:
        req.valueStr = value;
        break;
      case ConfigPrimitiveType.Number:
        req.valueNum = value;
        break;
      case ConfigPrimitiveType.Enum:
        req.valueEnum = value;
        break;
    }

    const updated = await native.hostProc.setConfigValue(req);
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

    load,
    setValue,
    getKey,
  };
});
