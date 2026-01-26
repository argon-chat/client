import { defineStore } from "pinia";
import { useIdle, useTimestamp } from "@vueuse/core";
import { interval, switchMap, type Subscription } from "rxjs";
import { useMe } from "./meStore";
import { ref } from "vue";
import { UserStatus } from "@argon/glue";
import { native } from "@argon/glue/native";

export const useIdleStore = defineStore("idle", () => {
  const subscription = ref<Subscription | null>(null);
  const isAutoAway = ref(false); // Track if Away was set automatically

  const IDLE_TIME_SECONDS = 60 * 3; // 3 minutes
  const CHECK_INTERVAL_MS = 2000; // 2 seconds

  function handleStatusChange(inactiveSeconds: number) {
    const me = useMe();
    const currentStatus = me.me?.currentStatus;

    if (!currentStatus) return;

    // Don't do anything if DoNotDisturb or TouchGrass is set
    if (currentStatus === UserStatus.DoNotDisturb || currentStatus === UserStatus.TouchGrass) {
      return;
    }

    // Reset auto-away flag if user manually changed status while auto-away was active
    if (isAutoAway.value && currentStatus !== UserStatus.Away) {
      isAutoAway.value = false;
      return;
    }
    // Only go Away from Online
    const shouldGoAway = inactiveSeconds >= IDLE_TIME_SECONDS && currentStatus === UserStatus.Online;
    // Only come back if it was auto-away
    const shouldComeBack = isAutoAway.value && currentStatus === UserStatus.Away && inactiveSeconds < IDLE_TIME_SECONDS;

    if (shouldGoAway) {
      isAutoAway.value = true;
      me.changeStatusTo(UserStatus.Away);
    } else if (shouldComeBack) {
      isAutoAway.value = false;
      me.changeStatusTo(UserStatus.Online);
    }
  }

  async function init() {
    // Clean up previous subscription if exists
    if (subscription.value) {
      subscription.value.unsubscribe();
    }

    if (argon.isArgonHost) {
      subscription.value = interval(CHECK_INTERVAL_MS)
        .pipe(
          switchMap(async () => {
            const inactiveSeconds = await native.hostProc.getIdleTimeSeconds();
            handleStatusChange(inactiveSeconds);
          }),
        )
        .subscribe();
    } else {
      const { lastActive } = useIdle(IDLE_TIME_SECONDS * 1000);
      const now = useTimestamp({ interval: 1000 });
      
      subscription.value = interval(CHECK_INTERVAL_MS)
        .pipe(
          switchMap(async () => {
            const inactiveSeconds = Math.floor(
              (now.value - lastActive.value) / 1000,
            );
            handleStatusChange(inactiveSeconds);
          }),
        )
        .subscribe();
    }
  }

  function cleanup() {
    if (subscription.value) {
      subscription.value.unsubscribe();
      subscription.value = null;
    }
  }

  return {
    init,
    cleanup,
  };
});
