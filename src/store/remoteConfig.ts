import { defineStore } from "pinia";
import { useFirebase } from "./firebase";
import { ref, computed } from "vue";
import { logger } from "@/lib/logger";
import { z } from "zod";

export const useConfig = defineStore("config", () => {
  const fb = useFirebase();
  
  const overrides = ref<{ [key: string]: string | boolean | number }>({
  });

  function setOverride(key: string, value: string | boolean | number) {
    logger.warn(`Overrided '${key}' with value '${value}'`);
    overrides.value[key] = value;
  }

  function removeOverride(key: string) {
    delete overrides.value[key];
  }

  function clearOverrides() {
    overrides.value = {};
  }

  function boolVal(key: string) {
    if (key in overrides.value) {
      return overrides.value[key] === true;
    }
    return fb.getBooleanSwitch(key);
  }
  function stringVal(key: string) {
    if (key in overrides.value) {
      return String(overrides.value[key]);
    }
    return fb.getStringKeyValue(key);
  }

  const isGenderEnabled = computed(() => boolVal("enabled_sex_field"));
  const apiEndpoint = computed(() => stringVal("apiEndpoint"));
  const cdnEndpoint = computed(() => stringVal("cdnEndpoint"));
  const webRtcEndpoint = computed(() => stringVal("webRtcEndpoint"));

  const scheme = z.object({
    cdnEndpoint: z.string().describe("CDN Endpoint").default(() => cdnEndpoint.value),
    apiEndpoint: z.string().describe("API Endpoint").default(() => apiEndpoint.value),
    webRtcEndpoint: z.string().describe("WebRTC Endpoint").default(() => webRtcEndpoint.value),
    enabled_sex_field: z.boolean().default(() => isGenderEnabled.value),
  });

  return {
    isGenderEnabled,
    apiEndpoint,
    cdnEndpoint,
    webRtcEndpoint,
    scheme,
    setOverride,
    removeOverride,
    clearOverrides,
  };
});