if (!('argon' in window)) {
    (window as any)["argon"]  = {
        dsn: function() {
            return "";
        },
        get isArgonHost(): boolean {
            return false;
        }
    } as IArgon;
}
const err = () => {
    console.error("Platform api is not supported in browser");
};

if (!('native' in window)) {
    (window as any)["native"]  = {
        allocConsole: err as any,
        beginMoveWindow: err as any,
        createKeybind: err as any,
        createPinnedObject: err as any,
        endMoveWindow: err as any,
        freePinnedObject: err as any,
        getDisplays: err as any,
        getHWNDs: err as any,
        listenActivity: err as any,
        pressSystemKey: err as any,
        V8ThreadingInit: err as any
    } as INative;
}