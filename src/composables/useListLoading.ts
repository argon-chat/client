import { ref, watch, onUnmounted, type Ref } from "vue";

/**
 * Brief "loading" flag for a key-driven, db-backed list. True while waiting for
 * the first data after `key` changes; cleared as soon as `count > 0` or after
 * `grace` ms. Lets components show skeletons only while genuinely loading —
 * never forever for a legitimately empty list, never at all for cached data.
 */
export function useListLoading(
  count: Ref<number>,
  key: Ref<unknown>,
  grace = 600,
): Ref<boolean> {
  const loading = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  watch(
    key,
    () => {
      clear();
      loading.value = count.value === 0; // skip skeleton when data is already cached
      if (loading.value) timer = setTimeout(() => (loading.value = false), grace);
    },
    { immediate: true },
  );

  watch(count, (n) => {
    if (n > 0) {
      loading.value = false;
      clear();
    }
  });

  onUnmounted(clear);

  return loading;
}
