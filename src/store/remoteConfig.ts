import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { logger } from "@argon/core";
import { z } from "zod";

export const useConfig = defineStore("config", () => {

  const overrides = ref<{ [key: string]: string | boolean | number }>({
   // apiEndpoint: 'https://localhost:5001'
   apiEndpoint: "https://api.argon.gl",
   apiDevEndpoint: "https://dev.api.argon.gl",
   apiLocalEndpoint: "https://localhost:5001"
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
    return false;
  }
  function stringVal(key: string) {
    if (key in overrides.value) {
      return String(overrides.value[key]);
    }
    throw new Error(key);
  }

  const isGenderEnabled = computed(() => boolVal("enabled_sex_field"));
  const apiEndpoint = computed(() => {
    const endpointSelector = localStorage.getItem("api_endpoint");
    if (endpointSelector && endpointSelector === "live")
      return stringVal("apiEndpoint");
    if (endpointSelector && endpointSelector === "dev")
      return stringVal("apiDevEndpoint") ?? "https://dev.argon.gl";
    if (endpointSelector && endpointSelector === "local")
      return stringVal("apiLocalEndpoint") ?? "https://localhost:5001";
    return stringVal("apiEndpoint");
  });
  const cdnEndpoint = computed(() => stringVal("cdnEndpoint"));
  const webRtcEndpoint = computed(() => stringVal("webRtcEndpoint"));
  const isDev = computed(
    () =>
      localStorage.getItem("api_endpoint") === "dev" ||
      localStorage.getItem("api_endpoint") === "local" ||
      apiEndpoint.value.includes("https://localhost:"),
  );

  const scheme = z.object({
    cdnEndpoint: z
      .string()
      .describe("CDN Endpoint")
      .default(() => cdnEndpoint.value),
    apiEndpoint: z
      .string()
      .describe("API Endpoint")
      .default(() => apiEndpoint.value),
    webRtcEndpoint: z
      .string()
      .describe("WebRTC Endpoint")
      .default(() => webRtcEndpoint.value),
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
    isDev,
  };
});
