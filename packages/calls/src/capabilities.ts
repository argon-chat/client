/**
 * Participant capabilities: what a participant's client offers the others in the call.
 *
 * Published as one LiveKit participant attribute, so every member learns it the moment it
 * changes and a late joiner reads it off the participant along with everything else. The
 * value is a space-separated list of tokens, `name` or `name=value` — `draw` is an offer to
 * anyone, `draw=contacts` an offer to the publisher's contacts.
 *
 * A capability is a fact about the publisher — the platform its client runs on, what the user
 * allowed for this call — not a permission: whoever acts on one still checks their own rights.
 */

export const CAPABILITIES_ATTR = "argon.caps";

export type Capabilities = ReadonlyMap<string, string>;

/** The capabilities in a participant's attributes; a bare token maps to "". */
export function parseCapabilities(
  attributes: Readonly<Record<string, string>> | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  const raw = attributes?.[CAPABILITIES_ATTR];
  if (!raw) return out;
  for (const token of raw.split(/\s+/)) {
    if (!token) continue;
    const eq = token.indexOf("=");
    if (eq < 0) out.set(token, "");
    else if (eq > 0) out.set(token.slice(0, eq), token.slice(eq + 1));
  }
  return out;
}

/** The attribute value for a set of capabilities; sorted, so equal sets encode equally. */
export function encodeCapabilities(capabilities: Capabilities): string {
  return [...capabilities]
    .map(([name, value]) => (value ? `${name}=${value}` : name))
    .sort()
    .join(" ");
}

/** Names and values are tokens: no whitespace, and no "=" in a name. */
export function isValidCapability(name: string, value: string): boolean {
  return name.length > 0 && !/[\s=]/.test(name) && !/\s/.test(value);
}
