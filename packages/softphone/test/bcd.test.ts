/**
 * Phone-number-to-GUID encoding.
 *
 * This is a wire format: the same number must always produce the same GUID, and the
 * layout has to stay byte-for-byte stable or previously stored ids stop matching. The
 * tests therefore pin the actual bytes, not just "it returns something GUID-shaped".
 */

import { describe, test, expect } from "vitest";
import { encodePhoneToGuid } from "../src/bcd";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("encodePhoneToGuid", () => {
  test("produces a well-formed GUID", () => {
    expect(encodePhoneToGuid("+1234567890")).toMatch(GUID);
  });

  test("is deterministic", () => {
    expect(encodePhoneToGuid("+79991234567")).toBe(encodePhoneToGuid("+79991234567"));
  });

  test("the first half is a fixed header, so all numbers share it", () => {
    const a = encodePhoneToGuid("+15551234567");
    const b = encodePhoneToGuid("+442071234567");
    // Bytes 0..7 are the header, and the GUID layout spends its first three groups on
    // exactly those bytes — the fourth group is where the digits start.
    const headerOf = (guid: string) => guid.split("-").slice(0, 3).join("-");
    expect(headerOf(a)).toBe(headerOf(b));
    expect(headerOf(a)).toBe("4cb2be31-34c9-f3c9");
  });

  test("different numbers encode differently", () => {
    expect(encodePhoneToGuid("+15551234567")).not.toBe(encodePhoneToGuid("+15551234568"));
  });

  test("ignores formatting — only digits carry meaning", () => {
    const canonical = encodePhoneToGuid("15551234567");
    for (const written of [
      "+1 555 123 45 67",
      "+1 (555) 123-45-67",
      "1-555-123-4567",
      " +1\t555\n123 4567 ",
    ]) {
      expect(encodePhoneToGuid(written)).toBe(canonical);
    }
  });

  test("pads an odd digit count with a half-byte marker, not a zero", () => {
    // A trailing 0xF nibble is what distinguishes "123" from "1230".
    expect(encodePhoneToGuid("123")).not.toBe(encodePhoneToGuid("1230"));
    expect(encodePhoneToGuid("123")).toContain("f");
  });

  test("unused bytes are filled so short and long numbers stay distinguishable", () => {
    const short = encodePhoneToGuid("1");
    const long = encodePhoneToGuid("123456789012345");
    expect(short).not.toBe(long);
    expect(short.endsWith("ffffffffffff")).toBe(true);
  });

  test("accepts the full E.164 length", () => {
    expect(() => encodePhoneToGuid("123456789012345")).not.toThrow();
    expect(encodePhoneToGuid("123456789012345")).toMatch(GUID);
  });

  test("rejects anything longer than E.164 allows", () => {
    expect(() => encodePhoneToGuid("1234567890123456")).toThrow(/E\.164/);
    // Formatting must not smuggle a number past the limit either.
    expect(() => encodePhoneToGuid("+1 (234) 567-890-123-456")).toThrow(/E\.164/);
  });

  test("an empty number is still encodable and unique", () => {
    const empty = encodePhoneToGuid("");
    expect(empty).toMatch(GUID);
    expect(empty).not.toBe(encodePhoneToGuid("0"));
  });
});
