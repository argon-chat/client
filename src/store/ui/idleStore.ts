import { defineStore } from "pinia";
import { useIdle, useTimestamp } from "@vueuse/core";
import { interval, switchMap, retry, type Subscription } from "rxjs";
import { useMe } from "@/store/auth/meStore";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { ref, watch, type WatchStopHandle } from "vue";
import { UserStatus } from "@argon/glue";
import { native } from "@argon/glue/native";

export const useIdleStore = defineStore("idle", () => {
  const subscription = ref<Subscription | null>(null);
  // useTimestamp is overloaded, and ReturnType picks its last signature — the `controls: true`
  // shape, which is not what the call below returns. Inferring the annotation from the factory
  // keeps the two from drifting apart again.
  const createWebTrackers = () => ({
    lastActive: useIdle(IDLE_TIME_SECONDS * 1000).lastActive,
    now: useTimestamp({ interval: 1000 }),
  });
  let webTrackers: ReturnType<typeof createWebTrackers> | null = null;
  // The status the detector set (Away or Snooze), or null when the current one is not its own.
  const autoStatus = ref<UserStatus | null>(null);
  const idleSeconds = ref(0);

  const IDLE_TIME_SECONDS = 60 * 3; // 3 minutes
  const SNOOZE_TIME_SECONDS = 60 * 60; // 1 hour
  // Each tick is an IPC round trip to the host (or a timestamp read on the web); the verdict only
  // needs minute-level accuracy, so 15 s is plenty and 43k round trips a day become ~6k.
  const CHECK_INTERVAL_MS = 15_000;

  // Talking in a call is activity that neither the OS idle timer nor the tab's input events see.
  let speaking = () => false;
  let lastSpokeAt = 0;
  let stopVoiceWatch: WatchStopHandle | null = null;

  function trackVoice() {
    if (stopVoiceWatch) return;
    const me = useMe();
    const voice = useUnifiedCall();
    speaking = () => {
      const id = me.me?.userId;
      return !!id && voice.speaking.has(id);
    };
    stopVoiceWatch = watch(speaking, () => { lastSpokeAt = Date.now(); });
  }

  function withVoice(inactiveSeconds: number) {
    if (speaking()) return 0;
    if (!lastSpokeAt) return inactiveSeconds;
    return Math.min(inactiveSeconds, Math.floor((Date.now() - lastSpokeAt) / 1000));
  }

  function handleStatusChange(inactiveSeconds: number) {
    const me = useMe();
    const currentStatus = me.me?.currentStatus;

    if (!currentStatus) return;

    // Don't do anything if DoNotDisturb or TouchGrass is set
    if (currentStatus === UserStatus.DoNotDisturb || currentStatus === UserStatus.TouchGrass) {
      return;
    }

    // The user changed status while the detector held it: theirs now.
    if (autoStatus.value !== null && currentStatus !== autoStatus.value) {
      autoStatus.value = null;
      return;
    }

    const idleFor = inactiveSeconds >= SNOOZE_TIME_SECONDS
      ? UserStatus.Snooze
      : inactiveSeconds >= IDLE_TIME_SECONDS ? UserStatus.Away : null;

    // Only go Away (or straight to Snooze) from Online, and only deepen an Away of our own.
    const next = currentStatus === UserStatus.Online
      ? idleFor
      : autoStatus.value !== null ? idleFor ?? UserStatus.Online : null;

    if (next === null || next === currentStatus) return;
    autoStatus.value = next === UserStatus.Online ? null : next;
    me.setTemporaryStatus(next);
  }

  function tick(inactiveSeconds: number) {
    const effective = withVoice(inactiveSeconds);
    idleSeconds.value = effective;
    handleStatusChange(effective);
  }

  async function init() {
    console.log("[IdleStore] Initializing idle tracking...");
    // Clean up previous subscription if exists
    if (subscription.value) {
      subscription.value.unsubscribe();
    }
    trackVoice();

    if (argon.isArgonHost) {
      subscription.value = interval(CHECK_INTERVAL_MS)
        .pipe(
          switchMap(async () => {
            try {
              // @ts-ignore
              const inactiveSeconds = await native.hostProc.getIdleTimeSeconds();
              tick(inactiveSeconds);
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
      // Created once: init() re-runs on every boot retry and account switch, and each call used to
      // add another set of window activity listeners plus a 1 s timestamp interval.
      if (!webTrackers) webTrackers = createWebTrackers();
      const { lastActive, now } = webTrackers;

      subscription.value = interval(CHECK_INTERVAL_MS)
        .pipe(
          switchMap(async () => {
            try {
              tick(Math.floor((now.value - lastActive.value) / 1000));
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
