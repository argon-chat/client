import { ref, reactive, watch, watchEffect, type Ref } from 'vue';

export function persistedValue<T extends object | string | number | boolean>(
  key: string, 
  defaultValue: T
): T extends object ? T : T extends boolean ? Ref<boolean> : Ref<T> {
  const storedValue = localStorage.getItem(key);

  let value: any;

  if (storedValue !== null) {
    try {
      const parsed: T = JSON.parse(storedValue);
      if (typeof parsed === "object" && parsed !== null) {
        value = reactive(parsed);
      } else {
        value = ref(parsed);
      }
    } catch (e) {
      console.error(`Ошибка парсинга JSON из localStorage для ключа "${key}"`, e);
      value = typeof defaultValue === "object" ? reactive(defaultValue) : ref(defaultValue);
    }
  } else {
    value = typeof defaultValue === "object" ? reactive(defaultValue) : ref(defaultValue);
  }

  if (typeof defaultValue === "object") {
    watchEffect(() => {
      console.log("watchEffect", key)
      localStorage.setItem(key, JSON.stringify(value));
    });
  } else {
    watch(value, (newValue) => {
      console.log("watch", key)
      localStorage.setItem(key, JSON.stringify(newValue));
    });
  }

  return value as any;
}
