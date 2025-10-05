import { logger } from "./logger";

if (!("argon" in window)) {
  (window as any).argon = {
    dsn: () => "",
    get isArgonHost(): boolean {
      return false;
    },
    get isMobileHost(): boolean {
      return window.matchMedia('(max-width: 768px)').matches;
    },
  } as IArgon;
}

type AnyHandler = (payload: any) => void;

class NativeBus implements INativeEventBus {
  private handlers = new Map<string, Set<AnyHandler>>();
  public subscribeToEvent<T>(key: string, fn: (t: T) => void) {
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }

    const set = this.handlers.get(key) ?? new Set();
    set.add(fn as AnyHandler);

    return () => {
      set.delete(fn as AnyHandler);
      if (set.size === 0) {
        this.handlers.delete(key);
      }
    };
  }

  public emit<T>(key: string, payload: T): void {
    logger.log("emited system event:", key, payload);
    const set = this.handlers.get(key);
    if (!set) return;

    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`Error in handler for ${key}`, err);
      }
    }
  }
}

const bus = new NativeBus();

if (!("native" in window)) {
  (window as any).native = new Proxy(
    {},
    {
      get: (_, __) => {
        throw `[${String(__)}] Platform api is not supported in browser`;
      },
    },
  ) as INative;
}

window.bus = bus;
