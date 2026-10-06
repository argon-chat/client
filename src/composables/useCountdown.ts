import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

/** Whole seconds left until `until`, ticking once a second; 0 when it is null or has passed. */
export function useCountdown(until: Ref<Date | null>) {
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  watch(
    until,
    (at) => {
      stop();
      now.value = Date.now();
      if (!at || at.getTime() <= now.value) return;
      timer = setInterval(() => {
        now.value = Date.now();
        if (now.value >= at.getTime()) stop();
      }, 1000);
    },
    { immediate: true },
  );

  onScopeDispose(stop);

  return computed(() => (until.value ? Math.max(0, Math.ceil((until.value.getTime() - now.value) / 1000)) : 0));
}
