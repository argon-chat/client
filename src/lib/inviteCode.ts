/**
 * Turns whatever a person pasted into the invite code underneath it.
 *
 * What arrives here is rarely a bare code. People paste the thing they were sent —
 * `https://argon.gl/i/ABC-DEF-GHI` for a space, `/v/…` for a voice room, sometimes the `argon://`
 * link the landing page handed to the app, sometimes with a query string or a trailing slash the
 * chat client added. Every one of those used to be sent to the server verbatim and come back
 * NOT_FOUND, which reads as "your invite is broken" rather than "paste the other half of it".
 *
 * Deliberately not a validator: a code is nine base62 characters and only the server can say whether
 * one exists, so anything that does not look like a URL is passed through untouched and the refusal
 * comes from the place that actually knows.
 */
export function extractInviteCode(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";

  // Custom schemes parse inconsistently through `new URL`, so both shapes are cut by hand: strip the
  // scheme and authority, then take the last non-empty path segment.
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  if (withoutScheme === trimmed && !trimmed.includes("/")) return trimmed;

  const path = withoutScheme.split(/[?#]/)[0];
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return trimmed;

  // "argon.gl/i/CODE" and "argon://invite/CODE" both end in the code; a bare "argon.gl" does not,
  // but then there is nothing better to send than what was pasted.
  return decodeURIComponent(segments[segments.length - 1]);
}
