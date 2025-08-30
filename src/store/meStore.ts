import { logger } from "@/lib/logger";
import { setUser } from "@sentry/vue";
import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useApi } from "./apiStore";
import { useBus } from "./busStore";
import { ArgonUser, UserStatus } from "@/lib/glue/argonChat";

export type ExtendedUser = {
  currentStatus: UserStatus;
} & ArgonUser;

export const useMe = defineStore("me", () => {
  const api = useApi();
  const bus = useBus();
  const me = ref(null as ExtendedUser | null);
  const preferredStatus = useLocalStorage<UserStatus>(
    "preferredStatus",
    UserStatus.Online,
    { initOnMounted: true, listenToStorageChanges: true, writeDefaults: true },
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

  async function init() {
    me.value = { currentStatus: preferredStatus.value, ...(await getMe()) };

    logger.info("Received user info ", me.value);
    WelcomeCommanderHasReceived.value = true;
    //bus.doListenMyEvents();

    setUser({ id: me.value.userId, username: me.value.username,  });
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
    WelcomeCommanderHasReceived,
    changeStatusTo,
    statusClass,
  };
});
