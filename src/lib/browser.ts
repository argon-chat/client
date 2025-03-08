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
    (window as any)["native"] = new Proxy({}, {
        get: (_, __) => err
    }) as INative;
}