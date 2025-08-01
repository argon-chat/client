import { logger } from "@/lib/logger";
import { setUser } from "@sentry/vue";
import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useApi } from "./apiStore";
import { useBus } from "./busStore";

export type ExtendedUser = {
  currentStatus:
    | "Offline"
    | "Online"
    | "Away"
    | "InGame"
    | "Listen"
    | "TouchGrass"
    | "DoNotDisturb";
} & IUser;

export const useMe = defineStore("me", () => {
  const api = useApi();
  const bus = useBus();
  const me = ref(null as ExtendedUser | null);
  const preferredStatus = useLocalStorage<UserStatus>(
    "preferredStatus",
    "Online",
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
    bus.onUserEvent<WelcomeCommander>("WelcomeCommander", (e) => {
      logger.box(`Welcome commander, ${e.welcomeMessage}`);
      if (me.value) me.value.currentStatus = e.status;
    });
    WelcomeCommanderHasReceived.value = true;
    bus.doListenMyEvents();

    setUser({ id: me.value.Id, username: me.value.Username });
  }

  const statusClass = (status: UserStatus | string, useBg = true) => {
    if (useBg)
      return {
        "bg-green-500": status === "Online",
        "bg-yellow-500": status === "Away",
        "bg-gray-500": status === "Offline",
        "bg-red-500": status === "DoNotDisturb",
      };

    return {
      "text-green-500": status === "Online",
      "text-yellow-500": status === "Away",
      "text-gray-500": status === "Offline",
      "text-red-500": status === "DoNotDisturb",
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
