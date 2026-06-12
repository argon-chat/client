import { defineStore } from "pinia";
import { useIdle, useTimestamp } from "@vueuse/core";
import { interval, switchMap, retry, type Subscription } from "rxjs";
import { useMe } from "@/store/auth/meStore";
import { ref } from "vue";
import { UserStatus } from "@argon/glue";
import { native } from "@argon/glue/native";

export const useIdleStore = defineStore("idle", () => {
  const subscription = ref<Subscription | null>(null);
  const isAutoAway = ref(false); // Track if Away was set automatically
  const idleSeconds = ref(0);

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
      me.setTemporaryStatus(UserStatus.Away);
    } else if (shouldComeBack) {
      isAutoAway.value = false;
      me.setTemporaryStatus(UserStatus.Online);
    }
  }

  async function init() {
    console.log("[IdleStore] Initializing idle tracking...");
    // Clean up previous subscription if exists
    if (subscription.value) {
      subscription.value.unsubscribe();
    }

    if (argon.isArgonHost) {
      subscription.value = interval(CHECK_INTERVAL_MS)
        .pipe(
          switchMap(async () => {
            try {
              // @ts-ignore
              const inactiveSeconds = await native.hostProc.getIdleTimeSeconds();
              idleSeconds.value = inactiveSeconds;
              handleStatusChange(inactiveSeconds);
            } catch (e) {
              // A transient IPC failure (e.g. host not ready right after launch)
              // must not tear down the stream — otherwise idle tracking dies for
              // the whole session and the user stays Online forever.
              console.warn("[IdleStore] idle tick failed", e);
            }
          }),
          // Belt-and-suspenders: if anything still errors the stream, restart it
          // after a short delay instead of letting the subscription die.
          retry({ delay: 5000 }),
        )
        .subscribe();
    } else {
      const { lastActive } = useIdle(IDLE_TIME_SECONDS * 1000);
      const now = useTimestamp({ interval: 1000 });

      subscription.value = interval(CHECK_INTERVAL_MS)
        .pipe(
          switchMap(async () => {
            try {
              const inactiveSeconds = Math.floor(
                (now.value - lastActive.value) / 1000,
              );
              idleSeconds.value = inactiveSeconds;
              handleStatusChange(inactiveSeconds);
            } catch (e) {
              console.warn("[IdleStore] idle tick failed", e);
            }
          }),
          retry({ delay: 5000 }),
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
    idleSeconds,
    init,
    cleanup,
  };
});
