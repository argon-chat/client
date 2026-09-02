/**
 * Product metrics, sent through Sentry's trace-metrics API (`Sentry.metrics.*`).
 *
 * This is the one place the app talks to `Sentry.metrics`. Call sites record *what happened*
 * (a message was sent, a call connected, a checkout started) and this module takes care of the
 * plumbing: the base attributes every metric carries, the guard that keeps a telemetry hiccup from
 * ever reaching user-facing code, and the small helpers that turn timings and error objects into
 * low-cardinality values.
 *
 * Rules for a good metric, enforced by convention here rather than by type:
 *
 * - Names are dotted, lower-case, domain first: `call.join`, `message.sent`, `ultima.checkout`.
 *   Counters name the event; distributions name the quantity (`call.duration`, `attachment.bytes`).
 * - Attributes are for *slicing*, so every value must come from a small fixed set: a mode, a
 *   result, an error kind, a bucket. Never a user id, channel id, free text or an error message —
 *   those explode cardinality on the Sentry side and, worse, are PII. The user is already attached
 *   by the SDK from `Sentry.setUser`, so per-user breakdowns still work without it.
 * - Every failure path records the same metric as the success path with `result: "failed"` and an
 *   `error` kind, so a rate is one query rather than two metrics stitched together.
 */
import * as Sentry from "@sentry/vue";
import { isWeb } from "@/lib/platform";

export type MetricAttributeValue = string | number | boolean;
export type MetricAttributes = Record<string, MetricAttributeValue | null | undefined>;

/** Units Sentry knows how to render; anything else is shown verbatim. */
export type MetricUnit = "millisecond" | "second" | "minute" | "byte" | "kilobyte" | "megabyte" | "none";

/** Which build recorded the metric — the first thing anybody slices by. */
const PLATFORM = isWeb ? "web" : "desktop";

/**
 * Coarse OS family from the user agent. The host's own OS bits are not reliable (see the
 * preload's hard-coded host id), and a coarse family is all a breakdown needs.
 */
function detectOs(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/CrOS/i.test(ua)) return "chromeos";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

const OS = detectOs();

function withBase(attrs?: MetricAttributes): Record<string, MetricAttributeValue> {
  const out: Record<string, MetricAttributeValue> = { platform: PLATFORM, os: OS };
  if (!attrs) return out;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/** Telemetry must never be the reason a feature broke. */
function guarded(fn: () => void): void {
  try {
    fn();
  } catch {
    /* swallowed on purpose */
  }
}

/** Increment a counter. `value` is how many, not a measurement — use `distribution` for those. */
export function count(name: string, attrs?: MetricAttributes, value = 1): void {
  guarded(() => Sentry.metrics.count(name, value, { attributes: withBase(attrs) }));
}

/** Record one sample of a measured quantity (a duration, a size, a count-per-user). */
export function distribution(name: string, value: number, unit: MetricUnit, attrs?: MetricAttributes): void {
  if (!Number.isFinite(value)) return;
  guarded(() =>
    Sentry.metrics.distribution(name, value, {
      unit: unit === "none" ? undefined : unit,
      attributes: withBase(attrs),
    }),
  );
}

/** Set a level that has a current value (things in flight, a cache size). */
export function gauge(name: string, value: number, unit: MetricUnit = "none", attrs?: MetricAttributes): void {
  if (!Number.isFinite(value)) return;
  guarded(() =>
    Sentry.metrics.gauge(name, value, {
      unit: unit === "none" ? undefined : unit,
      attributes: withBase(attrs),
    }),
  );
}

export interface MetricTimer {
  /** Record the elapsed time as a distribution (in milliseconds) and return it. */
  end(attrs?: MetricAttributes): number;
  /** Elapsed milliseconds so far, without recording anything. */
  elapsed(): number;
}

/**
 * Start timing something. `end()` records `name` as a millisecond distribution with the attributes
 * given here merged with those given at the end — so the outcome can be added once it is known.
 */
export function startTimer(name: string, attrs?: MetricAttributes): MetricTimer {
  const startedAt = performance.now();
  return {
    elapsed: () => performance.now() - startedAt,
    end(extra) {
      const ms = performance.now() - startedAt;
      distribution(name, ms, "millisecond", { ...attrs, ...extra });
      return ms;
    },
  };
}

/**
 * Time an async operation and record both the counter and the duration with a `result` attribute,
 * then hand the value (or the rejection) back untouched. Errors are classified with `errorKind`.
 */
export async function timed<T>(name: string, attrs: MetricAttributes, run: () => Promise<T>): Promise<T> {
  const timer = startTimer(`${name}.duration`, attrs);
  try {
    const value = await run();
    timer.end({ result: "ok" });
    count(name, { ...attrs, result: "ok" });
    return value;
  } catch (e) {
    const error = errorKind(e);
    timer.end({ result: "failed", error });
    count(name, { ...attrs, result: "failed", error });
    throw e;
  }
}

/**
 * A short, fixed-vocabulary label for an error — its class or DOMException name — never the
 * message. Messages carry ids, paths and user text; the kind is what a dashboard wants.
 */
export function errorKind(e: unknown): string {
  if (e === null || e === undefined) return "unknown";
  if (typeof e === "string") return "string";
  if (typeof e === "object") {
    const name = (e as { name?: unknown }).name;
    if (typeof name === "string" && name) return name;
    const ctor = (e as { constructor?: { name?: string } }).constructor?.name;
    if (ctor && ctor !== "Object") return ctor;
  }
  return typeof e;
}

/**
 * The name of an enum member, for numeric enums whose values would otherwise show up as bare
 * integers in a breakdown. String enums and unknown values pass through as-is.
 */
export function enumName(enumObject: Record<string, string | number>, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "number") {
    const name = enumObject[value];
    return typeof name === "string" ? name : String(value);
  }
  return value;
}

/**
 * Fold a number into one of a few labelled ranges so it can be an attribute. `edges` are the
 * upper bounds of each bucket, ascending; the last bucket is open-ended.
 *
 * `bucket(42, [10, 60, 300])` → `"10-60"`; `bucket(1000, [10, 60, 300])` → `"300+"`.
 */
export function bucket(value: number, edges: readonly number[]): string {
  if (!Number.isFinite(value)) return "unknown";
  let lower = 0;
  for (const edge of edges) {
    if (value < edge) return lower === 0 ? `<${edge}` : `${lower}-${edge}`;
    lower = edge;
  }
  return `${lower}+`;
}

/** The typical ranges for "how many" attributes: none, a few, some, many. */
export const COUNT_EDGES = [1, 2, 5, 10, 25, 100] as const;

export const metrics = { count, distribution, gauge, startTimer, timed, errorKind, enumName, bucket };
export default metrics;
