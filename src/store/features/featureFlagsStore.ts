import { logger } from "@argon/core";
import { FeatureFlagActivated } from "@argon/glue";
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";

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
  ULTIMA_ACTIVE: "af.ultima.active",
  BOOSTS_ACTIVE: "af.boosts.active",
  SPLIT_VIEW_ACTIVE: "af.split-view.active",
  UI_DENSITY_ACTIVE: "af.ui-density.active",
  OVERLAY_GAMES_ENABLED: "af.overlay.games.enabled",
} as const;

export type FeatureFlagKey = (typeof FeatureFlagKeys)[keyof typeof FeatureFlagKeys];

export const useFeatureFlags = defineStore("featureFlags", () => {
  const api = useApi();
  const bus = useBus();

  const flags = ref<Record<string, boolean>>({
    [FeatureFlagKeys.DASHBOARD_DIALPAD_ACTIVE]: true,
    [FeatureFlagKeys.INVENTORY_ACTIVE]: true,
    [FeatureFlagKeys.PROFILE_COINS_ACTIVE]: true,
    [FeatureFlagKeys.LEVELING_ACTIVE]: true,
    [FeatureFlagKeys.NOTIFICATION_ACTIVE]: false,
    [FeatureFlagKeys.PLAYFRAME_ACTIVE]: false,
    [FeatureFlagKeys.USER_SETTINGS_PASSKEY_ACTIVE]: true,
    [FeatureFlagKeys.USER_SETTINGS_AUTO_DELETE_ACCOUNT_ACTIVE]: false,
    [FeatureFlagKeys.DASHBOARD_ECHO_ACTIVE]: true,
    [FeatureFlagKeys.DASHBOARD_DM_ACTIVE]: true,
    [FeatureFlagKeys.ULTIMA_ACTIVE]: false,
    [FeatureFlagKeys.BOOSTS_ACTIVE]: false,
    [FeatureFlagKeys.SPLIT_VIEW_ACTIVE]: false,
    [FeatureFlagKeys.UI_DENSITY_ACTIVE]: false,
    [FeatureFlagKeys.OVERLAY_GAMES_ENABLED]: false,
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

  function subscribeToEvents(): void {
    bus.onServerEvent<FeatureFlagActivated>("FeatureFlagActivated", (event) => {
      if (!(event.flagId in flags.value)) {
        logger.debug("Ignoring activation for unknown feature flag", event.flagId);
        return;
      }

      flags.value[event.flagId] = event.isEnabled;
      logger.info("Feature flag activated", event.flagId, event.isEnabled, event.variant);
    });
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
  const ultimaActive = computed(() => flags.value[FeatureFlagKeys.ULTIMA_ACTIVE]);
  const boostsActive = computed(() => flags.value[FeatureFlagKeys.BOOSTS_ACTIVE]);
  const splitViewActive = computed(() => flags.value[FeatureFlagKeys.SPLIT_VIEW_ACTIVE]);
  const uiDensityActive = computed(() => flags.value[FeatureFlagKeys.UI_DENSITY_ACTIVE]);
  const overlayGamesEnabled = computed(() => flags.value[FeatureFlagKeys.OVERLAY_GAMES_ENABLED]);

  return {
    flags,
    isLoaded,
    loadFeatureFlags,
    subscribeToEvents,
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
    ultimaActive,
    boostsActive,
    splitViewActive,
    uiDensityActive,
    overlayGamesEnabled,
  };
});
