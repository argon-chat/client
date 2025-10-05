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
  interface IProcessEntity {
    appIcon?: stirng;
    name: string;
    pid: number;
    hash: string;
    kind: 0 | 1;
  }
  interface IAudioEntity {
    sessionId: string;
    TitleName: string;
    Author: string;
  }

  interface IProtectionStore {
    setValue(key: string, value: string): boolean;
    getValue(key: string): string | boolean;
  }

  interface IArgon {
    get isArgonHost(): boolean;
    get isMobileHost(): boolean;

    dsn(): string;

    onGameActivityDetected(
      pinnedFn: IPinnedFunction<void, [IProcessEntity]>
    ): boolean;
    onGameActivityTerminated(
      pinnedFn: IPinnedFunction<void, [number]>
    ): boolean;
    onMusicSessionPlayStateChanged(
      pinnedFn: IPinnedFunction<void, [string, boolean, string]>
    ): boolean;

    listenSessionMusic(): boolean;
    listenActivity(): boolean;

    storage: IArgonStorage;
  }

  interface IContextMenuItem {
    CommandId?: number;
    Label?: string;
    IsSeparator?: boolean;
    IsEnabled?: boolean;
    KeyCode?: string;
    Icon?: string;
    Children?: IContextMenuItem[],
    Action?: () => void
  }

  interface INative {
    getDisplays(): IScreen[];

    allocConsole(): void;

    getHWNDs(): IWindowInfo[];

    handleVueIntergration(
      appData: any,
      o: Storage,
      vue: Vue | Vue[] | undefined,
      router: VueRounter | undefined
    );

    V8ThreadingInit(): boolean;
    createPinnedObject<TArgs extends any[], TReturn>(
      o: (...args: TArgs) => TReturn
    ): IPinnedFunction<TReturn, TArgs>;
    createPinnedObject(o: object): IPinnedObject;
    freePinnedObject(obj: IPinnedObject): void;

    beginMoveWindow(): void;
    endMoveWindow(): void;

    listenActivity(mode: 0 | 1, callback: IPinnedObject): void;
    createKeybind(
      cfg: { keyCode: number; keyMod: ValidHotkeyModification; allowTrackUpDown: boolean; },
      pinnedFn: IPinnedObject
    ): Promise<number>;

    clearAllKeybinds(): void;

    pressSystemKey(key: SystemKey): void;

    toggleDevTools(): boolean;

    getCurrentChannel(): "beta" | "canary" | "live";
    setChannel(val: "beta" | "canary" | "live"): boolean;
    isRequiredToUpdate(): boolean;
    getIdleTimeSeconds(): number;

    openUrl(url: string): Promise<boolean>;

    openContextMenu(x: number, y: number, arr: IContextMenuItem[]): boolean;

    clipboardRead(): string;
    clipboardWrite(s: string);


    renderDiagnostic(i: number) : boolean;

    protectedStore: IProtectionStore;


    getStorageSpace(): { totalSize: string, availableFreeSpace: string };
  }


  interface INativeEventBus {
    subscribeToEvent<T>(key: string, fn: (t: T) => void):  () => void;
  }

  interface IArgonStorage {
    getItem(key: string): string | null;
    key(index: number): string | null;
    removeItem(key: string): void;
    setItem(key: string, value: string): void;
  }

  type IPinnedFunction<TReturn, TArgs extends any[]> = IPinnedObject &
    ((...args: TArgs) => TReturn);

  interface IPinnedObject {}

  var argon: IArgon;
  var native: INative;
  var bus: INativeEventBus;
}
