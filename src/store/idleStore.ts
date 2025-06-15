import { defineStore } from "pinia";
import { useIdle, useTimestamp } from "@vueuse/core";
import { interval, switchMap } from "rxjs";
import { useMe } from "./meStore";
import { ref } from "vue";
export const useIdleStore = defineStore("idle", () => {
  const savedStatus = ref("Online" as UserStatus);

  const idleTimeValue = 60 * 3;

  async function init() {
    const me = useMe();
    if (argon.isArgonHost) {
      interval(2000)
        .pipe(
          switchMap(() => {
            const inactiveSeconds = native.getIdleTimeSeconds();
            if (
              me.me?.currentStatus !== "Away" &&
              inactiveSeconds > idleTimeValue
            ) {
              savedStatus.value = me.me?.currentStatus;
              me.changeStatusTo("Away");
            } else if (
              me.me?.currentStatus === "Away" &&
              inactiveSeconds < idleTimeValue
            ) {
              me.changeStatusTo(savedStatus.value);
            }
            return Promise.resolve();
          }),
        )
        .subscribe();
    } else {
      const { lastActive } = useIdle(idleTimeValue);
      const now = useTimestamp({ interval: 1000 });
      interval(2000)
        .pipe(
          switchMap(() => {
            const inactiveSeconds = Math.floor(
              (now.value - lastActive.value) / 1000,
            );
            if (
              me.me?.currentStatus !== "Away" &&
              inactiveSeconds > idleTimeValue
            ) {
              savedStatus.value = me.me?.currentStatus;
              me.changeStatusTo("Away");
            } else if (
              me.me?.currentStatus === "Away" &&
              inactiveSeconds < idleTimeValue
            ) {
              me.changeStatusTo(savedStatus.value);
            }
            return Promise.resolve();
          }),
        )
        .subscribe();
    }
  }
  return {
    init,
  };
});
