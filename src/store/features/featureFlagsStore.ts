import { logger } from "@argon/core";
import { FeatureFlagActivated } from "@argon/glue";
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";

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
  SCREENCAST_DRAWING: "af.screencast.drawing",
  CHAT_GIFS_SELECTOR: "af.chat.gifs-selector",
} as const;

export type FeatureFlagKey = (typeof FeatureFlagKeys)[keyof typeof FeatureFlagKeys];

/**
 * Kill switches for cosmetic kinds, which cannot be an entry in the map above.
 *
 * The map is a closed list with a default per key, and it has to be: every other flag gates a piece
 * of this client, so a key it does not know is a key nothing reads. Cosmetic kinds are the opposite
 * — the server decides which kinds exist, and a build may meet a flag for a kind it has never heard
 * of — so they are matched by prefix and kept apart from the declared flags.
 *
 * Absence means enabled, the same rule the server applies. The flag is a kill switch, not an
 * enabler: a kind exists because a file in the build declares it, and requiring somebody to also
 * create a database row before shipped code does anything is how a feature ends up live, correct,
 * and invisible.
 */
export const COSMETIC_FLAG_PREFIX = "af.cosmetics.";

export function cosmeticFlagKeyFor(kindKey: string): string {
  return `${COSMETIC_FLAG_PREFIX}${kindKey.replaceAll(".", "-")}.active`;
}

export const useFeatureFlags = defineStore("featureFlags", () => {
  const api = useApi();
  const bus = useBus();

  const defaultFlags = (): Record<string, boolean> => ({
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
    [FeatureFlagKeys.SCREENCAST_DRAWING]: false,
    [FeatureFlagKeys.CHAT_GIFS_SELECTOR]: false,
  });

  const flags = ref<Record<string, boolean>>(defaultFlags());

  // Only the cosmetic kill switches the server actually declared. A kind with no entry here is on.
  const cosmeticFlags = ref<Record<string, boolean>>({});

  const isLoaded = ref(false);

  // Seamless account switch: reset to defaults; loadFeatureFlags() repopulates for the new account.
  onSessionReset(() => {
    flags.value = defaultFlags();
    cosmeticFlags.value = {};
    isLoaded.value = false;
  });

  /**
   * Records a flag the server sent, in whichever of the two sets it belongs to.
   *
   * Returns true when it was a cosmetic kill switch, because that is the case a caller may need to
   * react to — and having one function do this is what keeps the loader and the live event from
   * drifting apart, which is exactly what they did before: both had the same guard, and adding a
   * new kind of flag meant remembering both.
   */
  function record(flagId: string, isEnabled: boolean): boolean {
    if (flagId in flags.value) {
      flags.value[flagId] = isEnabled;
      return false;
    }

    if (flagId.startsWith(COSMETIC_FLAG_PREFIX)) {
      cosmeticFlags.value[flagId] = isEnabled;
      return true;
    }

    return false;
  }

  async function loadFeatureFlags(): Promise<void> {
    try {
      const serverFlags = await api.featureFlagInteraction.GetMyFeatureFlags();

      for (const flag of serverFlags) {
        record(flag.flagId, flag.isEnabled);
      }

      logger.info("Feature flags loaded", flags.value, cosmeticFlags.value);
      isLoaded.value = true;
    } catch (error) {
      logger.error("Failed to load feature flags", error);
    }
  }

  function isEnabled(flagKey: FeatureFlagKey): boolean {
    return flags.value[flagKey] ?? false;
  }

  function isCosmeticKindEnabled(kindKey: string): boolean {
    return cosmeticFlags.value[cosmeticFlagKeyFor(kindKey)] ?? true;
  }

  function subscribeToEvents(): void {
    bus.onServerEvent<FeatureFlagActivated>("FeatureFlagActivated", (event) => {
      if (!(event.flagId in flags.value) && !event.flagId.startsWith(COSMETIC_FLAG_PREFIX)) {
        logger.debug("Ignoring activation for unknown feature flag", event.flagId);
        return;
      }

      record(event.flagId, event.isEnabled);
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
  const screencastDrawingActive = computed(() => flags.value[FeatureFlagKeys.SCREENCAST_DRAWING]);
  const gifsSelectorActive = computed(() => flags.value[FeatureFlagKeys.CHAT_GIFS_SELECTOR]);

  return {
    flags,
    cosmeticFlags,
    isLoaded,
    loadFeatureFlags,
    subscribeToEvents,
    isEnabled,
    isCosmeticKindEnabled,
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
    screencastDrawingActive,
    gifsSelectorActive,
  };
});
