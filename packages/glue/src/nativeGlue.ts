import { CborReader, IonFormatterStorage } from "@argon-chat/ion.webcore";
import { ActivityKind, createClient, IHostProc, INativeEvent, PinnedFn } from "./argon.ipc";

if (!("ahid" in window)) {
  window["ahid"] = 0;
}

const map = new Map<number, (event: INativeEvent) => void>();
var index = 0;

class ArgonHostProxy implements IArgon {
  on<T extends INativeEvent>(
    key: T["UnionKey"],
    callback: (event: T) => void
  ): PinnedFn {
    index++;
    map.set(index, (ev: INativeEvent) => {
      if (ev.UnionKey != key)
        throw new Error(
          `FAILED EXECUTE HOST EVENT BUS, ${ev.UnionKey} != ${key}`
        );
      callback(ev as T);
    });
    return { id: index };
  }

  get ahid(): number {
    return window.ahid;
  }

  get isArgonHost(): boolean {
    return (
      this.isArgonHost_MacOs ||
      this.isArgonHost_Windows ||
      this.isArgonHost_Mobile
    );
  }
  get isArgonHost_MacOs(): boolean {
    return (this.ahid & (1 << 2)) == 1 << 2;
  }
  get isArgonHost_Windows(): boolean {
    return (this.ahid & (1 << 3)) == 1 << 3;
  }
  get isArgonHost_Mobile(): boolean {
    return (this.ahid & (1 << 4)) == 1 << 4;
  }
}

function deepFreeze<T>(obj: T | Object | any): T {
  Object.freeze(obj);

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (
      typeof value === "object" &&
      value !== null &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value);
    }
  }

  return obj;
}

class NativeProxy {
  readonly #client: ReturnType<typeof createClient>;

  constructor() {
    this.#client = createClient("native://protocol.v1", []);
  }

  get hostProc(): IHostProc {
    return this.#client.HostProc;
  }

  get dsn(): Promise<string> {
    if (argon.isArgonHost) return this.hostProc.dsn();
    return Promise.resolve("");
  }
}

window.argon = deepFreeze(new ArgonHostProxy());

window.addEventListener("native_abi", (e) => {
  const reader = new CborReader(e.detail.bytes);
  const result =
    IonFormatterStorage.get<INativeEvent>("INativeEvent").read(reader);
  console.log("Received:", result);

  const handler = map.get(e.detail.idx);

  if (handler) {
    handler(result);
  }
});



const native = new NativeProxy();
const argon = window.argon;

(window as any).native = native;
export { native, argon };
