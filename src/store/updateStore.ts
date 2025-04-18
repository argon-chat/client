import { defineStore } from "pinia";
import { interval, map } from "rxjs";
import { ref } from "vue";
const CHECK_INTERVAL_MS = 30_000;
export const useUpdater = defineStore("update", () => {
  const isRequiredToUpdate = ref(false);

  interval(CHECK_INTERVAL_MS)
  .pipe(map(() => native.isRequiredToUpdate()))
  .subscribe((result: boolean) => {
    isRequiredToUpdate.value = result;
  });

  return { isRequiredToUpdate };
});