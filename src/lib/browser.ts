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

if (!('native' in window)) {
    (window as any)["native"] = new Proxy({}, {
        get: (_, __) => {
            throw `[${String(__)}] Platform api is not supported in browser`;
        }
    }) as INative;
}