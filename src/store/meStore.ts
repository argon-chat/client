import { defineStore } from "pinia";
import { useApi } from "./apiStore";
import { ref } from "vue";
import { useBus } from "./busStore";
import { logger } from "@/lib/logger";
import { setUser } from "@sentry/vue";

export type ExtendedUser = { currentStatus: 'Offline' | 'Online' | 'Away' | 'InGame' | 'Listen' | 'TouchGrass' | 'DoNotDisturb' } & IUser;

export const useMe = defineStore("me", () => {
  const api = useApi();
  const bus = useBus();
  const me = ref(null as (ExtendedUser | null));

  const WelcomeCommanderHasReceived = ref(false);

  async function getMe() {
    return await api.userInteraction.GetMe();
  }


  async function init() {
    me.value = { currentStatus: "Online", ...(await getMe()) };

    logger.info("Received user info ", me.value);
    bus.onUserEvent<WelcomeCommander>("WelcomeCommander", (e) => {
        logger.box(`Welcome commander, ${e.welcomeMessage}`);
        me.value!.currentStatus = e.status;
    });
    WelcomeCommanderHasReceived.value = true;
    bus.doListenMyEvents();

    setUser({ id: me.value.Id, username: me.value.Username });
  }

  return {
    me,
    init,
    WelcomeCommanderHasReceived
  };
});
