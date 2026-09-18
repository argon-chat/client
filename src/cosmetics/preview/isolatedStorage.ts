/**
 * Local storage for the preview page alone, kept in memory and thrown away with the tab.
 *
 * <b>The preview is served from the same origin as the client it previews.</b> Everything the app
 * remembers about how it looks — the theme, the accent, the reduce-motion switch, the density — is a
 * key in that origin's local storage, and the renderers read those keys as they draw. Left alone,
 * two things follow, and both are wrong:
 *
 * - An operator switching the preview to light would switch their own chat client to light, because
 *   the write lands on the same key the app reads.
 * - Worse in the other direction: a row would be approved against whatever that operator happens to
 *   have set. A preview has to show the product's defaults, not the preferences of the one person
 *   looking at it, or "it looked fine to me" is the whole review.
 *
 * So the page runs on a storage of its own. It must be imported before anything that reads a
 * persisted value, which is why it is its own module and the first import of the entry point.
 */

/**
 * A `Storage` in a `Map`, behaving the way the real one does.
 *
 * Through a proxy rather than as a plain object with five methods on it: a real `Storage` also
 * answers `store.someKey`, `Object.keys(store)` and `delete store.someKey`, and a library reaching
 * for its value that way would find a method of the shim or nothing at all — which is the kind of
 * difference that costs an afternoon to see.
 */
function inMemoryStorage(): Storage {
  const values = new Map<string, string>();

  const api = {
    get length() {
      return values.size;
    },
    clear(): void {
      values.clear();
    },
    getItem(key: string): string | null {
      return values.has(String(key)) ? values.get(String(key))! : null;
    },
    key(index: number): string | null {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      values.delete(String(key));
    },
    setItem(key: string, value: string): void {
      values.set(String(key), String(value));
    },
  };

  return new Proxy(api, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver);
      if (typeof property === "symbol") return undefined;

      return values.get(property);
    },

    set(target, property, value) {
      if (property in target || typeof property === "symbol") return Reflect.set(target, property, value);

      values.set(property, String(value));

      return true;
    },

    has(target, property) {
      return property in target || (typeof property === "string" && values.has(property));
    },

    deleteProperty(_target, property) {
      if (typeof property === "string") values.delete(property);

      return true;
    },

    // Only the stored keys are enumerable, as on the real thing — the five methods are not what
    // `Object.keys(localStorage)` is asked for.
    ownKeys() {
      return [...values.keys()];
    },

    getOwnPropertyDescriptor(target, property) {
      if (typeof property === "string" && values.has(property)) {
        return { value: values.get(property), writable: true, enumerable: true, configurable: true };
      }

      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  }) as unknown as Storage;
}

// One each, as the browser has: the two are different namespaces and a key written to one must not
// come back out of the other.
const isolatedLocal = inMemoryStorage();
const isolatedSession = inMemoryStorage();

// Defined rather than assigned: `window.localStorage` is a getter on the prototype, so assigning to
// it does nothing at all in some browsers and throws in others.
Object.defineProperty(window, "localStorage", {
  configurable: true,
  get: () => isolatedLocal,
});

Object.defineProperty(window, "sessionStorage", {
  configurable: true,
  get: () => isolatedSession,
});

export { isolatedLocal as previewStorage };
