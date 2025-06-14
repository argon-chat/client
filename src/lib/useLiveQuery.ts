import { ref, watchEffect, onScopeDispose, type Ref } from "vue";
import { liveQuery, type Subscription } from "dexie";

export function useLiveQuery<T>(
  queryFn: () => Promise<T> | T,
): Ref<T | undefined> {
  const result = ref<T>();

  let subscription: Subscription | undefined;

  watchEffect(() => {
    const observable = liveQuery(queryFn);
    subscription?.unsubscribe();
    subscription = observable.subscribe({
      next: (value) => {
        result.value = value;
      },
      error: (err) => {
        console.error("liveQuery error", err);
      },
    });
  });

  onScopeDispose(() => {
    subscription?.unsubscribe();
  });

  return result;
}
