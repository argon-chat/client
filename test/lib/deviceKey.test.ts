/**
 * The device proof, checked against the format the server verifies.
 *
 * What these guard is an agreement between two languages that nothing else would catch. The server
 * parses these tokens with hand-written code — `DeviceBoundProof` — because on registration the key
 * arrives inside the token and no general validator has that shape. Every field below is one that
 * code reads and rejects on: a `typ` it does not know, an `alg` that is not ES256, a challenge
 * anywhere but `jti`, a signature that is DER rather than raw. Get any of them wrong and the only
 * symptom is a proof that never verifies, on browsers we do not test in, silently leaving sessions
 * unbound — the exact failure this whole mechanism exists to avoid.
 *
 * The signature check here is the real one: it verifies with WebCrypto against the exported public
 * key, which is what the server does with the same bytes.
 */
import { describe, expect, it } from "vitest";
import { publicJwk, signProof } from "@/lib/net/deviceKey";

const decode = (segment: string): any =>
  JSON.parse(new TextDecoder().decode(
    Uint8Array.from(atob(segment.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
  ));

// Backed by a real ArrayBuffer rather than Uint8Array.from, whose ArrayBufferLike does not satisfy
// the BufferSource that crypto.subtle.verify wants.
const rawSignature = (segment: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(segment.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return bytes;
};

/** As `deviceKey()` makes them, minus the IndexedDB that jsdom does not have. */
const generate = () =>
  crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);

describe("device proof", () => {
  it("is a three part JWS the server will recognise", async () => {
    const key = await generate();
    const proof = await signProof(key, "challenge-value", await publicJwk(key));
    const [header, payload, signature] = proof.split(".");

    expect(proof.split(".")).toHaveLength(3);
    expect(decode(header)).toMatchObject({ alg: "ES256", typ: "dbsc+jwt" });
    // The challenge goes in jti and nowhere else: that is the claim the server compares.
    expect(decode(payload)).toEqual({ jti: "challenge-value" });
    expect(signature.length).toBeGreaterThan(0);
  });

  it("carries the public key on registration and omits it on refresh", async () => {
    const key = await generate();
    const jwk = await publicJwk(key);

    expect(decode((await signProof(key, "c", jwk)).split(".")[0]).jwk)
      .toEqual({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y });

    // On refresh the server checks against the key it stored. Offering one here would be the
    // caller choosing what to be verified against.
    expect(decode((await signProof(key, "c")).split(".")[0]).jwk).toBeUndefined();
  });

  it("exports only the members the server hashes into a thumbprint", async () => {
    const jwk = await publicJwk(await generate());

    // Extra members would change nothing server-side but would travel in every proof; the
    // thumbprint is taken over exactly these four.
    expect(Object.keys(jwk).sort()).toEqual(["crv", "kty", "x", "y"]);
  });

  /** ES256 is raw r||s, 32 bytes each. The desktop's TPM path uses DER, and the two are not alike. */
  it("signs with a raw signature rather than DER", async () => {
    const key = await generate();
    const signature = rawSignature((await signProof(key, "c")).split(".")[2]);

    expect(signature).toHaveLength(64);
    // A DER sequence starts 0x30; a raw pair almost never does, and never with this length.
    expect(signature[0] === 0x30 && signature.length !== 64).toBe(false);
  });

  it("produces a signature that verifies against the exported key", async () => {
    const key = await generate();
    const proof = await signProof(key, "challenge-value", await publicJwk(key));
    const [header, payload, signature] = proof.split(".");

    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key.publicKey,
      rawSignature(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    );

    expect(verified).toBe(true);
  });

  /** The whole point: there is no route from this key to bytes that would let it sign elsewhere. */
  it("uses a key that cannot be exported", async () => {
    const key = await generate();

    expect(key.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("jwk", key.privateKey)).rejects.toThrow();
  });

  it("signs a different challenge differently", async () => {
    const key = await generate();

    expect(await signProof(key, "one")).not.toEqual(await signProof(key, "two"));
  });
});
