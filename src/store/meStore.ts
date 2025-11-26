import { logger } from "@/lib/logger";
import { setUser } from "@sentry/vue";
import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useApi } from "./apiStore";
import { useBus } from "./busStore";
import {
  ArgonUser,
  BadAuthKind,
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

  const WelcomeCommanderHasReceived = ref(false);

  async function getMe() {
    return await api.userInteraction.GetMe();
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

    logger.error("GetMyAuthorization", result);

    if (result.isBadAuthStatus()) {
      useAuthStore().logout();
      location.reload();
      return false;
    }

    me.value = { currentStatus: preferredStatus.value, ...(await getMe()) };

    logger.info("Received user info ", me.value);
    WelcomeCommanderHasReceived.value = true;

    setUser({ id: me.value.userId, username: me.value.username });

    if (result.isGoodAuthStatus()) {
      useAuthStore().setAuthToken(result.token);
      return true;
    }

    if (result.isLockedAuthStatus()) {
      limitation.value = result;
      logger.warn("Detected restriction on account", result);
      return false;
    }

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
    init,
    completeInit,
    WelcomeCommanderHasReceived,
    changeStatusTo,
    statusClass,
    isPremium,
    limitation,
  };
});
