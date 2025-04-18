export {};

declare global {
  interface IScreen {
    DisplayIndex: string;
    Width: number;
    Height: number;
    Left: number;
    Top: number;
    IsPrimary: boolean;
    Freq: number;
  }
  declare const enum HotkeyModification {
    NONE = 0,
    HAS_ALT = 1,
    HAS_CTRL = 1 << 1,
    HAS_SHIFT = 1 << 2,
    HAS_WIN = 1 << 3,
  }

  declare const enum SystemKey {
    CLOSE = 0,
    MINIMIZE = 1,
    EXPAND = 2,
  }

  declare type ValidHotkeyModification =
    | HotkeyModification.NONE
    | HotkeyModification.HAS_ALT
    | HotkeyModification.HAS_CTRL
    | HotkeyModification.HAS_SHIFT
    | HotkeyModification.HAS_WIN
    | (HotkeyModification.HAS_ALT | HotkeyModification.HAS_CTRL)
    | (HotkeyModification.HAS_ALT | HotkeyModification.HAS_SHIFT)
    | (HotkeyModification.HAS_ALT | HotkeyModification.HAS_WIN)
    | (HotkeyModification.HAS_CTRL | HotkeyModification.HAS_SHIFT)
    | (HotkeyModification.HAS_CTRL | HotkeyModification.HAS_WIN)
    | (HotkeyModification.HAS_SHIFT | HotkeyModification.HAS_WIN)
    | (
        | HotkeyModification.HAS_ALT
        | HotkeyModification.HAS_CTRL
        | HotkeyModification.HAS_SHIFT
      )
    | (
        | HotkeyModification.HAS_ALT
        | HotkeyModification.HAS_CTRL
        | HotkeyModification.HAS_WIN
      )
    | (
        | HotkeyModification.HAS_ALT
        | HotkeyModification.HAS_SHIFT
        | HotkeyModification.HAS_WIN
      )
    | (
        | HotkeyModification.HAS_CTRL
        | HotkeyModification.HAS_SHIFT
        | HotkeyModification.HAS_WIN
      )
    | (
        | HotkeyModification.HAS_ALT
        | HotkeyModification.HAS_CTRL
        | HotkeyModification.HAS_SHIFT
        | HotkeyModification.HAS_WIN
      );
      interface IWindowInfo {
        deviceId: string;
        title: string;
      }

  interface IArgon {
    get isArgonHost(): boolean;

    dsn(): string;
  }

  interface INative {
    getDisplays(): IScreen[];

    allocConsole(): void;

    getHWNDs(): IWindowInfo[];

    V8ThreadingInit(): boolean;
    createPinnedObject(o: object): IPinnedObject;
    freePinnedObject(obj: IPinnedObject): void;

    beginMoveWindow(): void;
    endMoveWindow(): void;

    listenActivity(mode: 0 | 1, callback: IPinnedObject): void;
    createKeybind(
      cfg: { keyCode: number; keyMod: ValidHotkeyModification },
      pinnedFn: IPinnedObject
    ): Promise<number>;

    clearAllKeybinds(): void;

    pressSystemKey(key: SystemKey): void;


    toggleDevTools(): boolean;


    getCurrentChannel(): "beta" | "canary" | "live";
    setChannel(val: "beta" | "canary" | "live"): boolean;
    isRequiredToUpdate(): boolean;
  }

  interface IPinnedObject {}

  var argon: IArgon;
  var native: INative;
}
