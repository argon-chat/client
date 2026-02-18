import { logger } from "@argon/core";
import { FeatureFlagData } from "@argon/glue";
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useApi } from "./apiStore";

export const FeatureFlagKeys = {
  DASHBOARD_DIALPAD_ACTIVE: "af.dashboard.dialpad.active",
  INVENTORY_ACTIVE: "af.inventory.active",
  PROFILE_COINS_ACTIVE: "af.profile.coins.active",
  LEVELING_ACTIVE: "af.leveling.active",
  NOTIFICATION_ACTIVE: "af.notification.active",
  PLAYFRAME_ACTIVE: "af.playframe.active",
  USER_SETTINGS_PASSKEY_ACTIVE: "af.user.settings.passkey.active",
  USER_SETTINGS_AUTO_DELETE_ACCOUNT_ACTIVE: "af.user.settings.auto-delete-account.active",
  DASHBOARD_ECHO_ACTIVE: "af.dashboard.echo.active",
  DASHBOARD_DM_ACTIVE: "af.dashboard.dm.active",
} as const;

export type FeatureFlagKey = (typeof FeatureFlagKeys)[keyof typeof FeatureFlagKeys];

export const useFeatureFlags = defineStore("featureFlags", () => {
  const api = useApi();

  const flags = ref<Record<string, boolean>>({
    [FeatureFlagKeys.DASHBOARD_DIALPAD_ACTIVE]: false,
    [FeatureFlagKeys.INVENTORY_ACTIVE]: false,
    [FeatureFlagKeys.PROFILE_COINS_ACTIVE]: false,
    [FeatureFlagKeys.LEVELING_ACTIVE]: false,
    [FeatureFlagKeys.NOTIFICATION_ACTIVE]: false,
    [FeatureFlagKeys.PLAYFRAME_ACTIVE]: false,
    [FeatureFlagKeys.USER_SETTINGS_PASSKEY_ACTIVE]: false,
    [FeatureFlagKeys.USER_SETTINGS_AUTO_DELETE_ACCOUNT_ACTIVE]: false,
    [FeatureFlagKeys.DASHBOARD_ECHO_ACTIVE]: false,
    [FeatureFlagKeys.DASHBOARD_DM_ACTIVE]: false,
  });

  const isLoaded = ref(false);

  async function loadFeatureFlags(): Promise<void> {
    try {
      const serverFlags = await api.featureFlagInteraction.GetMyFeatureFlags();
      
      for (const flag of serverFlags) {
        if (flag.flagId in flags.value) {
          flags.value[flag.flagId] = flag.isEnabled;
        }
      }

      logger.info("Feature flags loaded", flags.value);
      isLoaded.value = true;
    } catch (error) {
      logger.error("Failed to load feature flags", error);
    }
  }

  function isEnabled(flagKey: FeatureFlagKey): boolean {
    return flags.value[flagKey] ?? false;
  }

  const dialpadActive = computed(() => flags.value[FeatureFlagKeys.DASHBOARD_DIALPAD_ACTIVE]);
  const inventoryActive = computed(() => flags.value[FeatureFlagKeys.INVENTORY_ACTIVE]);
  const profileCoinsActive = computed(() => flags.value[FeatureFlagKeys.PROFILE_COINS_ACTIVE]);
  const levelingActive = computed(() => flags.value[FeatureFlagKeys.LEVELING_ACTIVE]);
  const notificationActive = computed(() => flags.value[FeatureFlagKeys.NOTIFICATION_ACTIVE]);
  const playframeActive = computed(() => flags.value[FeatureFlagKeys.PLAYFRAME_ACTIVE]);
  const passkeyActive = computed(() => flags.value[FeatureFlagKeys.USER_SETTINGS_PASSKEY_ACTIVE]);
  const autoDeleteAccountActive = computed(() => flags.value[FeatureFlagKeys.USER_SETTINGS_AUTO_DELETE_ACCOUNT_ACTIVE]);
  const echoActive = computed(() => flags.value[FeatureFlagKeys.DASHBOARD_ECHO_ACTIVE]);
  const dmActive = computed(() => flags.value[FeatureFlagKeys.DASHBOARD_DM_ACTIVE]);

  return {
    flags,
    isLoaded,
    loadFeatureFlags,
    isEnabled,
    dialpadActive,
    inventoryActive,
    profileCoinsActive,
    levelingActive,
    notificationActive,
    playframeActive,
    passkeyActive,
    autoDeleteAccountActive,
    echoActive,
    dmActive,
  };
});
