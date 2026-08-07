/**
 * WebAuthn passkey flows.
 *
 * The manager sits between a Fido2NetLib server and the browser's credentials API, and
 * its real job is translation: base64url in, ArrayBuffers out, and back again. A
 * mistake there is not a crash — the ceremony simply fails on the authenticator or the
 * server rejects the signature, which is unpleasant to debug from a user report. The
 * other half is error mapping: a cancelled prompt must never look like a broken device.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { PasskeyManager } from "../src/PasskeyManager";

vi.mock("@argon/core", () => ({
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}));

// ── Helpers ─────────────────────────────────────────────────────────

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const bufFrom = (s: string) => {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
};
const textOf = (buf: ArrayBuffer) => String.fromCharCode(...new Uint8Array(buf));

const creationOptions = () =>
  JSON.stringify({
    challenge: b64url("chal-1"),
    rp: { id: "argon.gl", name: "Argon" },
    user: { id: b64url("user-7"), name: "who", displayName: "Who" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: { userVerification: "preferred" },
    excludeCredentials: [{ id: b64url("known-cred"), type: "public-key", transports: ["internal"] }],
    extensions: { credProps: true },
  });

const requestOptions = () =>
  JSON.stringify({
    challenge: b64url("chal-2"),
    rpId: "argon.gl",
    timeout: 60000,
    userVerification: "required",
    allowCredentials: [{ id: b64url("cred-1"), type: "public-key", transports: ["usb"] }],
  });

const attestationCredential = () => ({
  id: "cred-id",
  rawId: bufFrom("raw-id"),
  type: "public-key",
  response: {
    attestationObject: bufFrom("attestation"),
    clientDataJSON: bufFrom("client-data"),
  },
  getClientExtensionResults: () => ({ credProps: { rk: true } }),
});

const assertionCredential = (userHandle: ArrayBuffer | null = bufFrom("user-7")) => ({
  id: "cred-id",
  rawId: bufFrom("raw-id"),
  type: "public-key",
  response: {
    authenticatorData: bufFrom("auth-data"),
    clientDataJSON: bufFrom("client-data"),
    signature: bufFrom("signature"),
    userHandle,
  },
});

function makeApi() {
  return {
    beginAddPasskey: vi.fn(async () => ({ success: true, optionsJson: creationOptions() })),
    completeAddPasskey: vi.fn(async () => ({
      success: true,
      passkey: { id: "pk-1", name: "Laptop", createdAt: "2026-01-01" },
    })),
    removePasskey: vi.fn(async () => ({ success: true })),
    beginValidatePasskey: vi.fn(async () => ({ success: true, optionsJson: requestOptions() })),
    completeValidatePasskey: vi.fn(async () => ({ success: true })),
  };
}

let api: ReturnType<typeof makeApi>;
let credentials: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

beforeEach(() => {
  api = makeApi();
  credentials = {
    create: vi.fn(async () => attestationCredential()),
    get: vi.fn(async () => assertionCredential()),
  };
  vi.stubGlobal("navigator", { credentials });
  vi.stubGlobal("window", { PublicKeyCredential: class {} });
});

// ── Tests ───────────────────────────────────────────────────────────

describe("isSupported", () => {
  test("true when the browser exposes WebAuthn", () => {
    expect(new PasskeyManager(api).isSupported()).toBe(true);
  });

  test("false without PublicKeyCredential", () => {
    vi.stubGlobal("window", {});
    expect(new PasskeyManager(api).isSupported()).toBe(false);
  });

  test("false without a credentials store", () => {
    vi.stubGlobal("navigator", {});
    expect(new PasskeyManager(api).isSupported()).toBe(false);
  });
});

describe("createPasskey: decoding the server's options", () => {
  test("base64url fields reach the authenticator as buffers", async () => {
    await new PasskeyManager(api).createPasskey("Laptop");

    const { publicKey } = credentials.create.mock.calls[0][0];
    expect(textOf(publicKey.challenge)).toBe("chal-1");
    expect(textOf(publicKey.user.id)).toBe("user-7");
  });

  test("decoding handles base64url's alphabet and missing padding", async () => {
    // '-' and '_' stand in for '+' and '/', and the trailing '=' is stripped — feeding
    // that to atob() unchanged throws or yields the wrong bytes.
    const tricky = "\xfb\xff\xfe";
    api.beginAddPasskey = vi.fn(async () => ({
      success: true,
      optionsJson: JSON.stringify({
        ...JSON.parse(creationOptions()),
        challenge: b64url(tricky),
      }),
    }));

    await new PasskeyManager(api).createPasskey("Laptop");

    const { publicKey } = credentials.create.mock.calls[0][0];
    expect(textOf(publicKey.challenge)).toBe(tricky);
  });

  test("excluded credentials are decoded too, so a device is not enrolled twice", async () => {
    await new PasskeyManager(api).createPasskey("Laptop");

    const { publicKey } = credentials.create.mock.calls[0][0];
    expect(publicKey.excludeCredentials).toHaveLength(1);
    expect(textOf(publicKey.excludeCredentials[0].id)).toBe("known-cred");
    expect(publicKey.excludeCredentials[0].transports).toEqual(["internal"]);
  });

  test("options with no excludeCredentials produce an empty list, not undefined", async () => {
    const { excludeCredentials: _drop, ...rest } = JSON.parse(creationOptions());
    api.beginAddPasskey = vi.fn(async () => ({ success: true, optionsJson: JSON.stringify(rest) }));

    await new PasskeyManager(api).createPasskey("Laptop");

    expect(credentials.create.mock.calls[0][0].publicKey.excludeCredentials).toEqual([]);
  });

  test("the rest of the options are passed through untouched", async () => {
    await new PasskeyManager(api).createPasskey("Laptop");

    const { publicKey } = credentials.create.mock.calls[0][0];
    expect(publicKey.rp).toEqual({ id: "argon.gl", name: "Argon" });
    expect(publicKey.timeout).toBe(60000);
    expect(publicKey.attestation).toBe("none");
    expect(publicKey.authenticatorSelection).toEqual({ userVerification: "preferred" });
  });
});

describe("createPasskey: encoding the response", () => {
  test("buffers go back to the server as base64url", async () => {
    await new PasskeyManager(api).createPasskey("Laptop");

    const sent = JSON.parse(api.completeAddPasskey.mock.calls[0][0]);
    expect(sent.rawId).toBe(b64url("raw-id"));
    expect(sent.response.attestationObject).toBe(b64url("attestation"));
    expect(sent.response.clientDataJSON).toBe(b64url("client-data"));
    expect(sent.id).toBe("cred-id");
    expect(sent.type).toBe("public-key");
  });

  test("base64url encoding is url-safe and unpadded", async () => {
    credentials.create = vi.fn(async () => ({
      ...attestationCredential(),
      rawId: bufFrom("\xfb\xff\xfe"),
    }));

    await new PasskeyManager(api).createPasskey("Laptop");

    const { rawId } = JSON.parse(api.completeAddPasskey.mock.calls[0][0]);
    expect(rawId).not.toMatch(/[+/=]/);
  });

  test("client extension results are forwarded", async () => {
    await new PasskeyManager(api).createPasskey("Laptop");
    const sent = JSON.parse(api.completeAddPasskey.mock.calls[0][0]);
    expect(sent.extensions).toEqual({ credProps: { rk: true } });
  });

  test("a successful creation reports what the server stored", async () => {
    const result = await new PasskeyManager(api).createPasskey("Laptop");
    expect(result).toEqual({
      success: true,
      passkeyId: "pk-1",
      name: "Laptop",
      createdAt: "2026-01-01",
    });
  });
});

describe("createPasskey: refusals", () => {
  test("an empty name never reaches the server", async () => {
    const result = await new PasskeyManager(api).createPasskey("   ");

    expect(result.success).toBe(false);
    expect(api.beginAddPasskey).not.toHaveBeenCalled();
  });

  test("a server that will not begin stops the ceremony", async () => {
    api.beginAddPasskey = vi.fn(async () => ({ success: false }));

    const result = await new PasskeyManager(api).createPasskey("Laptop");

    expect(result.success).toBe(false);
    expect(credentials.create).not.toHaveBeenCalled();
  });

  test("a null credential is reported rather than sent on", async () => {
    credentials.create = vi.fn(async () => null);

    const result = await new PasskeyManager(api).createPasskey("Laptop");

    expect(result.success).toBe(false);
    expect(api.completeAddPasskey).not.toHaveBeenCalled();
  });

  test("a cancelled prompt is not reported as a broken device", async () => {
    // These codes drive the message the user sees; conflating them turns "you pressed
    // Escape" into "your device is unsupported".
    for (const [name, code] of [
      ["NotAllowedError", "CANCELLED"],
      ["NotSupportedError", "NOT_SUPPORTED"],
      ["InvalidStateError", "INVALID_STATE"],
      ["SomethingElse", "UNKNOWN"],
    ] as const) {
      const err = new Error("x");
      err.name = name;
      credentials.create = vi.fn(async () => { throw err; });

      const result = await new PasskeyManager(makeApi()).createPasskey("Laptop");
      expect(result.errorCode, name).toBe(code);
      expect(result.success).toBe(false);
    }
  });
});

describe("validatePasskey", () => {
  test("decodes assertion options for the authenticator", async () => {
    await new PasskeyManager(api).validatePasskey();

    const { publicKey } = credentials.get.mock.calls[0][0];
    expect(textOf(publicKey.challenge)).toBe("chal-2");
    expect(publicKey.rpId).toBe("argon.gl");
    expect(publicKey.userVerification).toBe("required");
    expect(textOf(publicKey.allowCredentials[0].id)).toBe("cred-1");
  });

  test("encodes the assertion back for the server", async () => {
    const result = await new PasskeyManager(api).validatePasskey();

    const sent = JSON.parse(api.completeValidatePasskey.mock.calls[0][0]);
    expect(sent.response.authenticatorData).toBe(b64url("auth-data"));
    expect(sent.response.signature).toBe(b64url("signature"));
    expect(sent.response.userHandle).toBe(b64url("user-7"));
    expect(result.success).toBe(true);
  });

  test("an absent user handle is sent as null, not as an empty string", async () => {
    // Fido2NetLib distinguishes the two; "" would be read as a zero-length handle.
    credentials.get = vi.fn(async () => assertionCredential(null));

    await new PasskeyManager(api).validatePasskey();

    expect(JSON.parse(api.completeValidatePasskey.mock.calls[0][0]).response.userHandle).toBeNull();
  });

  test("missing options stop the ceremony", async () => {
    api.beginValidatePasskey = vi.fn(async () => ({ success: true }));

    const result = await new PasskeyManager(api).validatePasskey();

    expect(result.success).toBe(false);
    expect(credentials.get).not.toHaveBeenCalled();
  });

  test("a rejected assertion is surfaced as a failure", async () => {
    api.completeValidatePasskey = vi.fn(async () => ({ success: false }));
    expect((await new PasskeyManager(api).validatePasskey()).success).toBe(false);
  });

  test("maps the ceremony's error codes, including no-passkey-found", async () => {
    for (const [name, code] of [
      ["NotAllowedError", "CANCELLED"],
      ["NotSupportedError", "NOT_SUPPORTED"],
      ["NotFoundError", "NOT_FOUND"],
      ["Whatever", "UNKNOWN"],
    ] as const) {
      const err = new Error("x");
      err.name = name;
      credentials.get = vi.fn(async () => { throw err; });

      const result = await new PasskeyManager(makeApi()).validatePasskey();
      expect(result.errorCode, name).toBe(code);
    }
  });
});

describe("removePasskey", () => {
  test("passes the id through and reports success", async () => {
    const result = await new PasskeyManager(api).removePasskey("pk-1");

    expect(api.removePasskey).toHaveBeenCalledWith("pk-1");
    expect(result.success).toBe(true);
  });

  test("a refusal is reported, not thrown", async () => {
    api.removePasskey = vi.fn(async () => ({ success: false }));
    expect((await new PasskeyManager(api).removePasskey("pk-1")).success).toBe(false);
  });

  test("a network failure is caught", async () => {
    api.removePasskey = vi.fn(async () => { throw new Error("offline"); });
    await expect(new PasskeyManager(api).removePasskey("pk-1")).resolves.toMatchObject({
      success: false,
    });
  });
});
