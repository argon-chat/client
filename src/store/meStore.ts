import { logger } from "@/lib/logger";
import { setUser } from "@sentry/vue";
import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useApi } from "./apiStore";
import { useBus } from "./busStore";
import {
  ArgonUser,
  ArgonUserProfile,
  BadAuthKind,
  LockdownReason,
  LockdownSeverity,
  LockedAuthStatus,
  UserStatus,
} from "@/lib/glue/argonChat";
import { useAuthStore } from "./authStore";
import delay from "@/lib/delay";

export type ExtendedUser = {
  currentStatus: UserStatus;
} & ArgonUser;

export const useMe = defineStore("me", () => {
  const api = useApi();
  const bus = useBus();
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
    { initOnMounted: true, listenToStorageChanges: true, writeDefaults: true }
  );

  preferredStatus.value = UserStatus.Online;

  const WelcomeCommanderHasReceived = ref(false);

  async function getMe() {
    return await api.userInteraction.GetMe();
  }
  async function getMeProfile(): Promise<ArgonUserProfile> {
    return await api.userInteraction.GetMyProfile();
  }

  async function changeStatusTo(status: UserStatus) {
    if (me.value?.currentStatus === status) return;
    preferredStatus.value = status;
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
    statusClass,
    isPremium,
    limitation,
  };
});
