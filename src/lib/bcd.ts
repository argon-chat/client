const BCD_HEADER = 0xF3C934C94CB2BE31n;


export function encodePhoneToGuid(phone: string): string {
    const digits = phone.replace(/\D/g, "");

    if (digits.length > 15) {
        throw new Error("Phone number exceeds E.164 limit (15 digits)");
    }

    const bytes = new Uint8Array(16);

    let h = BCD_HEADER;
    for (let i = 0; i < 8; i++) {
        bytes[i] = Number(h & 0xFFn);
        h >>= 8n;
    }

    let byteIndex = 8;
    for (let i = 0; i < digits.length; i += 2) {
        const high = digits.charCodeAt(i) - 48;
        const low =
            i + 1 < digits.length
                ? digits.charCodeAt(i + 1) - 48
                : 0xF;

        bytes[byteIndex++] = (high << 4) | low;
    }
    while (byteIndex < 16) {
        bytes[byteIndex++] = 0xFF;
    }

    return bytesToGuid(bytes);
}

function bytesToGuid(b: Uint8Array): string {
    const hex = [...b].map(x => x.toString(16).padStart(2, "0"));

    return (
        hex.slice(0, 4).reverse().join("") + "-" +
        hex.slice(4, 6).reverse().join("") + "-" +
        hex.slice(6, 8).reverse().join("") + "-" +
        hex.slice(8, 10).join("") + "-" +
        hex.slice(10, 16).join("")
    );
}