/**
 * The capability attribute: a space-separated list of `name` or `name=value` tokens, read off
 * any participant and written for our own. Encoding is canonical so equal sets compare equal.
 */

import { describe, test, expect } from "vitest";
import { CAPABILITIES_ATTR, encodeCapabilities, isValidCapability, parseCapabilities } from "../src/capabilities";

describe("capabilities", () => {
  test("nothing published reads as no capabilities", () => {
    expect(parseCapabilities(undefined).size).toBe(0);
    expect(parseCapabilities({}).size).toBe(0);
    expect(parseCapabilities({ [CAPABILITIES_ATTR]: "" }).size).toBe(0);
  });

  test("a bare token is an offer to anyone, a valued one carries its value", () => {
    const caps = parseCapabilities({ [CAPABILITIES_ATTR]: "draw=contacts  relay" });
    expect(caps.get("draw")).toBe("contacts");
    expect(caps.get("relay")).toBe("");
    expect(caps.has("other")).toBe(false);
  });

  test("a token without a name is ignored rather than decoded as something", () => {
    expect(parseCapabilities({ [CAPABILITIES_ATTR]: "=x draw" })).toEqual(new Map([["draw", ""]]));
  });

  test("encoding is sorted, so the same set always encodes the same way", () => {
    const a = encodeCapabilities(new Map([["relay", ""], ["draw", "contacts"]]));
    const b = encodeCapabilities(new Map([["draw", "contacts"], ["relay", ""]]));
    expect(a).toBe("draw=contacts relay");
    expect(b).toBe(a);
    expect(parseCapabilities({ [CAPABILITIES_ATTR]: a })).toEqual(new Map([["draw", "contacts"], ["relay", ""]]));
  });

  test("names and values are single tokens", () => {
    expect(isValidCapability("draw", "")).toBe(true);
    expect(isValidCapability("draw", "contacts")).toBe(true);
    expect(isValidCapability("", "")).toBe(false);
    expect(isValidCapability("dr aw", "")).toBe(false);
    expect(isValidCapability("draw=1", "")).toBe(false);
    expect(isValidCapability("draw", "a b")).toBe(false);
  });
});
