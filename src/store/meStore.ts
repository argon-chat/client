import { logger } from "@argon/core";
import { setUser } from "@sentry/vue";
import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useApi } from "./apiStore";
import { useBus } from "./busStore";
import { useFeatureFlags } from "./featureFlagsStore";
import {
  ArgonUser,
  ArgonUserProfile,
  BadAuthKind,
  LockdownReason,
  LockdownSeverity,
  LockedAuthStatus,
  UserStatus,
} from "@argon/glue";
import { useAuthStore } from "./authStore";

export type ExtendedUser = {
  currentStatus: UserStatus;
} & ArgonUser;

export const useMe = defineStore("me", () => {
  const api = useApi();
  const bus = useBus();
  const featureFlags = useFeatureFlags();
  const me = ref(null as ExtendedUser | null);
  const meProfile = ref(null as ArgonUserProfile | null);

  const limitation = ref(null as LockedAuthStatus | null);

  const isPremium = ref(false);

  function toggleIsPremium() {
    isPremium.value = true;
  }

  (window as any)["tgp"] = toggleIsPremium; // for testing purpose

  const preferredStatus = useLocalStorage<UserStatus>(
    "preferredStatus",
    UserStatus.Online,
    { listenToStorageChanges: true, writeDefaults: true }
  );

  // Away shouldn't be persisted - it's only for automatic idle detection
  if (preferredStatus.value === UserStatus.Away) {
    preferredStatus.value = UserStatus.Online;
  }

  const WelcomeCommanderHasReceived = ref(false);

  async function getMe() {
    return await api.userInteraction.GetMe();
  }
  async function getMeProfile(): Promise<ArgonUserProfile> {
    return await api.userInteraction.GetMyProfile();
  }

  // For automatic status changes (idle detection) - doesn't touch preferredStatus
  function setTemporaryStatus(status: UserStatus) {
    if (me.value?.currentStatus === status) return;
    if (me.value) me.value.currentStatus = status;
  }

  // For user-initiated status changes - only updates preferredStatus for DND/TouchGrass
  async function changeStatusTo(status: UserStatus) {
    if (me.value?.currentStatus === status) return;
    // Only persist DoNotDisturb and TouchGrass to preferredStatus
    // Online/Away are managed automatically by idle detection
    if (status === UserStatus.DoNotDisturb || status === UserStatus.TouchGrass) {
      preferredStatus.value = status;
    } else if (preferredStatus.value === UserStatus.DoNotDisturb || preferredStatus.value === UserStatus.TouchGrass) {
      // Coming back from DND/TouchGrass - reset to Online
      preferredStatus.value = UserStatus.Online;
    }
    if (me.value) me.value.currentStatus = status;
  }

  async function completeInit() {
    bus.doListenMyEvents();
  }

  async function init(): Promise<boolean> {
    const authStore = useAuthStore();

    const result = await api.identityInteraction.GetMyAuthorization(
      authStore.token!,
      authStore.getRefreshToken()
    );

    logger.info("GetMyAuthorization", result);

    if (result.isBadAuthStatus()) {
      useAuthStore().logout();
      location.reload();
      return false;
    }
    else if (result.isGoodAuthStatus()) {
      useAuthStore().setAuthToken(result.token);
    }
    else if (result.isLockedAuthStatus()) {
      limitation.value = result;
      logger.warn("Detected restriction on account", result);
      return false;
    } else if (result.isCertificateErrorAuthStatus()) {
      limitation.value = new LockedAuthStatus(LockdownReason.BAD_CLIENT, null, false, LockdownSeverity.Low);
      logger.warn("Detected used bad client", result);
      return false;
    }

    me.value = { currentStatus: preferredStatus.value, ...(await getMe()) };
    meProfile.value = await getMeProfile();
    logger.info("Received user info ", me.value);
    logger.info("Received user profile ", meProfile.value);
    
    await featureFlags.loadFeatureFlags();
    
    WelcomeCommanderHasReceived.value = true;

    setUser({ id: me.value.userId, username: me.value.username });

    return true;
  }

  const statusClass = (status: UserStatus, useBg = true) => {
    if (useBg)
      return {
        "bg-green-500": status === UserStatus.Online,
        "bg-yellow-500": status === UserStatus.Away,
        "bg-gray-500": status === UserStatus.Offline,
        "bg-red-500": status === UserStatus.DoNotDisturb,
      };

    return {
      "text-green-500": status === UserStatus.Online,
      "text-yellow-500": status === UserStatus.Away,
      "text-gray-500": status === UserStatus.Offline,
      "text-red-500": status === UserStatus.DoNotDisturb,
    };
  };

  return {
    me,
    meProfile,
    init,
    completeInit,
    WelcomeCommanderHasReceived,
    changeStatusTo,
    setTemporaryStatus,
    statusClass,
    isPremium,
    limitation,
  };
});
