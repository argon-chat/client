/** Dexie's transaction zones temporarily replace these methods. Skathi AOT protects the
 * engine's Promise, so give Dexie an application constructor with its own writable methods. */
export function installTransactionPromise(host: { Promise: PromiseConstructor }): void {
  const NativePromise = host.Promise;
  class TransactionPromise<T> extends NativePromise<T> {}
  for (const name of ["all", "race", "resolve", "reject", "allSettled", "any"] as const) {
    Object.defineProperty(TransactionPromise, name, {
      value: NativePromise[name],
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(host, "Promise", {
    value: TransactionPromise,
    configurable: true,
    writable: true,
  });
}

if (import.meta.env.ARGON_NATIVE_AOT) installTransactionPromise(globalThis);
