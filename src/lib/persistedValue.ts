import { ref, reactive, watch, watchEffect, type Ref, type UnwrapRef, Reactive } from 'vue';
import superjson from 'superjson';
import { logger } from './logger';

export function persistedValue<T extends object | string | number | boolean>(
  key: string,
  defaultValue: T
): T extends object ? Reactive<T> : Ref<T> {

  logger.log("Persist value", key, defaultValue);

  const storedValue = localStorage.getItem(key);

  let value: any;

  if (storedValue !== null) {
    try {
      const parsed = superjson.parse(storedValue);
      if (typeof parsed === "object" && parsed !== null) {
        value = reactive(parsed) as UnwrapRef<T>;
      } else {
        value = ref(parsed) as Ref<T>;
      }
    } catch (e) { 
      console.error(`Ошибка парсинга JSON из localStorage для ключа "${key}"`, e);
      value = typeof defaultValue === "object"
        ? (reactive(defaultValue) as UnwrapRef<T>)
        : (ref(defaultValue) as Ref<T>);
    }
  } else {
    value = typeof defaultValue === "object"
      ? (reactive(defaultValue) as UnwrapRef<T>)
      : (ref(defaultValue) as Ref<T>);
  }

  if (typeof defaultValue === "object") {
    watchEffect(() => {
      localStorage.setItem(key, superjson.stringify(value));
    });
  } else {
    watch(value, (newValue) => {
      localStorage.setItem(key, superjson.stringify(newValue));
    });
  }

  return value as any;
}
