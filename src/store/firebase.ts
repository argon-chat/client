import { defineStore } from "pinia";
import { initializeApp } from "firebase/app";
import {
  getRemoteConfig,
  fetchAndActivate,
  getValue,
} from "firebase/remote-config";

export const useFirebase = defineStore("firebase", () => {
  const firebaseConfig = {
    apiKey: "AIzaSyDn7jFo9A5Glh_CNxhiGfK3IHUZpcVds_Y",
    projectId: "argon-chat",
    appId: "1:782212206831:web:94cf4fc000868f6a8e0b1a",
    measurementId: "G-ZGQ0NSTDE4",
  };

  const firebaseApp = initializeApp(firebaseConfig);

  const remoteConfig = getRemoteConfig(firebaseApp);

  remoteConfig.settings.minimumFetchIntervalMillis = 300000;

  async function initCfg() {
    await fetchAndActivate(remoteConfig);
  }

  function getStringKeyValue(key: string): string {
    return getValue(remoteConfig, key).asString();
  }

  function getNumberKeyValue(key: string): number {
    return getValue(remoteConfig, key).asNumber();
  }

  function getBooleanSwitch(key: string): boolean {
    return getValue(remoteConfig, key).asBoolean();
  }

  return { initCfg, getStringKeyValue, getNumberKeyValue, getBooleanSwitch };
});
