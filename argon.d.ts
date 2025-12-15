import type { INativeEvent, PinnedFn } from "@/lib/glue/argon.ipc";

export {};

declare global {
  interface IArgon {
    get isArgonHost(): boolean;
    get isArgonHost_MacOs(): boolean;
    get isArgonHost_Windows(): boolean;
    get isArgonHost_Mobile(): boolean;

    on<T extends INativeEvent>(
      key: T["UnionKey"],
      callback: (event: T) => void
    ): PinnedFn;
  }

  var argon: IArgon;

  interface AbiEv {
    bytes: ArrayBuffer | Uint8Array;
    idx: number;
  }

  interface WindowEventMap {
    native_abi: CustomEvent<AbiEv>;
  }
}
