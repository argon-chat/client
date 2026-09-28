import { describe, test, expect } from "vitest";
import { HASH_MAX_BYTES, sha256Hex } from "@/lib/attachments/hash";

describe("attachment hashing", () => {
  test("is SHA-256 as lower-case hex", async () => {
    expect(await sha256Hex(new Blob(["abc"]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("declines a file the server would never read back either", async () => {
    const huge = { size: HASH_MAX_BYTES + 1, arrayBuffer: () => Promise.reject(new Error("should not be read")) } as unknown as Blob;
    expect(await sha256Hex(huge)).toBeNull();
  });
});
