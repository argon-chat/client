import { ref, watch, onUnmounted, type Ref } from "vue";

export interface ListLoadingOptions {
  /** How long to wait for the first data before giving up and treating the list as empty (ms). */
  grace?: number;
  /**
   * How long to wait before showing a skeleton (ms). A db-backed list usually answers within a
   * frame or two; a skeleton shown for that long only flashes, and swapping it out costs its
   * leave transition before the real list can enter.
   */
  delay?: number;
}

export interface ListLoading {
  /** Show the skeleton: no data yet for this key, and `delay` has passed. */
  skeleton: Ref<boolean>;
  /** No data yet for this key, within `grace`: the list is not known to be empty yet. */
  waiting: Ref<boolean>;
}

/**
 * "Loading" state for a key-driven, db-backed list. `waiting` is true from a `key` change until
 * `count > 0` or `grace` ms pass; `skeleton` is true while waiting once `delay` ms have passed.
 * Lets components show skeletons only while genuinely loading — never forever for a legitimately
 * empty list, and not at all when the data comes back quickly.
 */
export function useListLoading(count: Ref<number>, key: Ref<unknown>, options: ListLoadingOptions = {}): ListLoading {
  const { grace = 600, delay = 0 } = options;
  const waiting = ref(false);
  const skeleton = ref(false);
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let delayTimer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (graceTimer) clearTimeout(graceTimer);
    if (delayTimer) clearTimeout(delayTimer);
    graceTimer = delayTimer = null;
  };
  const settle = () => {
    clear();
    waiting.value = false;
    skeleton.value = false;
  };

  watch(
    key,
    () => {
      settle();
      if (count.value > 0) return; // cached: no skeleton at all
      waiting.value = true;
      if (delay > 0) delayTimer = setTimeout(() => (skeleton.value = waiting.value), delay);
      else skeleton.value = true;
      graceTimer = setTimeout(settle, grace);
    },
    { immediate: true },
  );

  watch(count, (n) => {
    if (n > 0) settle();
  });

  onUnmounted(clear);

  return { skeleton, waiting };
}
