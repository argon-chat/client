import { createClient, IHostProc } from "./argon.ipc";

if (!('ahid' in window)) {
    window["ahid"] = 0;
}
class ArgonHostProxy implements IArgon {
    get ahid(): number {
        return window.ahid;
    }

    get isArgonHost(): boolean {
        return this.isArgonHost_MacOs || this.isArgonHost_Windows || this.isArgonHost_Mobile;
    }
    get isArgonHost_MacOs(): boolean {
        return (this.ahid & 1 << 2) == 1 << 2;
    }
    get isArgonHost_Windows(): boolean {
        return (this.ahid & 1 << 3) == 1 << 3;
    }
    get isArgonHost_Mobile(): boolean {
        return (this.ahid & 1 << 4) == 1 << 4;
    }

}

function deepFreeze<T>(obj: T | Object | any) : T {
  Object.freeze(obj);

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value);
    }
  }

  return obj;
}


class NativeProxy {
    readonly #client: ReturnType<typeof createClient>

    constructor() {
        this.#client = createClient("native://protocol.v1", [])
    }

    get hostProc(): IHostProc {
        return this.#client.HostProc;
    }


    get dsn(): Promise<string> {
        if (argon.isArgonHost)
            return this.hostProc.dsn();
        return Promise.resolve("");
    }
}



window.argon = deepFreeze(new ArgonHostProxy());


const native = new NativeProxy();


export { native }