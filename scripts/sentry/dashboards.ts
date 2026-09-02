/**
 * The Argon product-metric dashboards in Sentry, as code.
 *
 * Every widget reads the trace metrics the client sends (see src/lib/telemetry/metrics.ts for the
 * catalogue). Edit here, then re-run: a dashboard with the same title is replaced, so this file is
 * the source of truth, not what was clicked together in the UI.
 *
 *   bun run sentry:dashboards -- --dry                 print, create nothing (no token needed)
 *   bun run sentry:dashboards -- --create              create/replace all four
 *   bun run sentry:dashboards -- --create --only Calls
 *
 * Needs SENTRY_AUTH_TOKEN in the environment (scopes org:read, org:write, project:read). Ask the
 * user for it; it is never read from a file and never printed.
 *
 * How a trace-metric widget is encoded (the widget editor relies on every part of this):
 *   - the metric lives INSIDE the aggregate: `sum(value,<name>,<type>,<unit>)`,
 *     `p95(value,call.join.duration,distribution,millisecond)`,
 *     `count_unique(user.id,app.session.started,counter,none)`,
 *     `equation|sum(value,call.duration,distribution,second) / 60`;
 *   - <type> is counter | gauge | distribution and <unit> must be exactly what the client sends
 *     (`none` when it sends no unit) — a wrong unit silently returns null;
 *   - `conditions` carries attribute filters only (`result:ok mode:channel`), never `metric.name:`.
 * Other rules the server enforces: displayType ∈ line/area/bar/big_number/categorical_bar/heatmap;
 * grouping needs a widget-level `limit` (max 10); at most one equation per timeseries widget.
 */

const ORG = "argon";
const PROJECT = 22;
const BASE = "https://sentry.argon.gl/api/0";
const COLS = 6;

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const after = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);

// ───────────────────────────── metric catalogue ─────────────────────────────
// Type and unit of every metric the client sends, exactly as declared at the call site
// (`metrics.count` → counter/none; `metrics.distribution(name, v, unit)` → distribution/unit).
// Keep in sync with the code: a metric missing here cannot be put on a dashboard.

type MetricType = "counter" | "gauge" | "distribution";
type MetricUnit = "none" | "millisecond" | "second" | "byte";
type MetricSpec = readonly [type: MetricType, unit: MetricUnit];

const C: MetricSpec = ["counter", "none"];
const MS: MetricSpec = ["distribution", "millisecond"];
const SEC: MetricSpec = ["distribution", "second"];
const NUM: MetricSpec = ["distribution", "none"];
const BYTES: MetricSpec = ["distribution", "byte"];

const METRICS = {
  // app / session
  "app.boot": C,
  "app.boot.attempt_failed": C,
  "app.boot.duration": MS,
  "app.boot.step.duration": MS,
  "app.session.started": C,
  "app.post_login.failed": C,
  "session.resume": C,
  "session.resume.slept": SEC,
  "account.switch": C,
  "locale.changed": C,
  "user.status.changed": C,
  "legal.accepted": C,
  "feedback.sent": C,
  // auth
  "auth.login": C,
  "auth.register": C,
  "auth.logout": C,
  "auth.session.restore": C,
  "auth.session.check": C,
  "auth.token.refresh": C,
  "auth.password_reset.begin": C,
  "auth.password_reset": C,
  // realtime
  "realtime.connected": C,
  "realtime.disconnected": C,
  "realtime.outage.duration": MS,
  "realtime.reconnect.attempts": NUM,
  "realtime.reconnect.manual": C,
  "realtime.resync.full": C,
  "realtime.ticket.failed": C,
  "realtime.event.decode_failed": C,
  "realtime.worker.error": C,
  // calls
  "call.join": C,
  "call.join.duration": MS,
  "call.room.size": NUM,
  "call.duration": SEC,
  "call.ended": C,
  "call.disconnected": C,
  "call.reconnecting": C,
  "call.reconnected": C,
  "call.reconnect.duration": MS,
  "call.quality": C,
  "call.turn.probe": C,
  "call.track.subscription_failed": C,
  "call.playback.blocked": C,
  "call.cpu_constrained": C,
  "call.audio_device.error": C,
  "call.crash_recovery": C,
  "call.dm.outgoing": C,
  "call.dm.incoming": C,
  "call.dm.accepted": C,
  "call.dm.rejected": C,
  "call.screenshare.start": C,
  "call.screenshare.duration": SEC,
  "call.camera.start": C,
  "call.camera.duration": SEC,
  // messaging
  "message.sent": C,
  "message.send.duration": MS,
  "message.text.length": NUM,
  "attachment.upload": C,
  "attachment.upload.duration": MS,
  "attachment.bytes": BYTES,
  "reaction.toggle": C,
  // spaces
  "space.created": C,
  "space.joined": C,
  "space.membership.count": NUM,
  "space.load.duration": MS,
  "space.invite.created": C,
  "space.invite.revoked": C,
  "channel.created": C,
  "channel.deleted": C,
  // monetization
  "ultima.checkout": C,
  "ultima.subscription.cancel": C,
  "ultima.subscription.state": C,
  "ultima.boost": C,
  "ultima.boost_pack.purchase": C,
  "ultima.gift": C,
  // activities
  "activity.start": C,
  "activity.stop": C,
  "activity.duration": SEC,
} as const satisfies Record<string, MetricSpec>;

type MetricName = keyof typeof METRICS;

/** A metric plus the attribute filters to apply to it. */
interface MetricRef {
  name: MetricName;
  conditions: string;
}

/** `M("call.join", "result:ok")` */
const M = (name: MetricName, conditions = ""): MetricRef => ({ name, conditions });

/**
 * `F(M("call.duration"), "p95")` → `p95(value,call.duration,distribution,second)`.
 * `F(m, "count_unique(user.id)")` → `count_unique(user.id,<name>,<type>,<unit>)`.
 */
function F(metric: MetricRef, aggregate: string): string {
  const [type, unit] = METRICS[metric.name];
  const fn = aggregate.includes("(") ? aggregate.replace(/\)$/, "") : `${aggregate}(value`;
  return `${fn},${metric.name},${type},${unit})`;
}

// ───────────────────────────── widget model ─────────────────────────────

type DisplayType = "line" | "area" | "bar" | "big_number" | "categorical_bar" | "heatmap";

interface WidgetQuery {
  name: string;
  conditions: string;
  fields: string[];
  aggregates: string[];
  columns: string[];
  orderby: string;
}

interface WidgetDraft {
  title: string;
  displayType: DisplayType;
  widgetType: "tracemetrics";
  queries: WidgetQuery[];
  description?: string;
  interval?: string;
  limit?: number;
  /** Grid size, consumed by layout(). */
  _w: number;
  _h: number;
}

interface Widget extends Omit<WidgetDraft, "_w" | "_h"> {
  layout: { x: number; y: number; w: number; h: number; minH: number };
}

interface Dashboard {
  title: string;
  widgets: Widget[];
  projects: number[];
  period: string;
  environment: string[];
  filters: Record<string, unknown>;
}

interface WidgetOptions {
  w?: number;
  h?: number;
  limit?: number;
  interval?: string;
  description?: string;
}

/**
 * One query line. `aggregates` are short names (`sum`, `p95`, `count_unique(user.id)`) or full
 * equations (`equation|<full functions>`); everything else is expanded through F().
 */
function q(
  metric: MetricRef,
  aggregates: string[],
  { columns = [], name = "", orderby }: { columns?: string[]; name?: string; orderby?: string } = {},
): WidgetQuery {
  const full = aggregates.map((a) => (a.startsWith("equation|") ? a : F(metric, a)));
  return {
    name,
    conditions: metric.conditions,
    fields: [...columns, ...full],
    aggregates: full,
    columns,
    orderby: orderby ?? (columns.length ? `-${full[0]}` : ""),
  };
}

function widget(
  title: string,
  displayType: DisplayType,
  queries: WidgetQuery[],
  { w = 2, h = 2, limit, interval = "1h", description }: WidgetOptions = {},
): WidgetDraft {
  const grouped = queries.some((x) => x.columns.length > 0);
  const out: WidgetDraft = { title, displayType, widgetType: "tracemetrics", queries, _w: w, _h: h };
  if (description) out.description = description;
  if (displayType !== "big_number") out.interval = interval;
  if (grouped) out.limit = limit ?? 10;
  return out;
}

/** Big number. `aggregate` is a short name, or a function of `F(metric, …)` for an equation. */
const big = (title: string, metric: MetricRef, aggregate: string | ((f: (agg: string) => string) => string) = "sum", description?: string) => {
  const agg = typeof aggregate === "function" ? `equation|${aggregate((a) => F(metric, a))}` : aggregate;
  return widget(title, "big_number", [q(metric, [agg])], { w: 1, h: 1, description });
};
const line = (title: string, queries: WidgetQuery[], opts?: WidgetOptions) => widget(title, "line", queries, opts);
const area = (title: string, queries: WidgetQuery[], opts?: WidgetOptions) => widget(title, "area", queries, opts);
/** Categorical bar: one bar per value of `column`. */
const bars = (title: string, metric: MetricRef, column: string, aggregate = "sum", opts: WidgetOptions = {}) =>
  widget(title, "categorical_bar", [q(metric, [aggregate], { columns: [column] })], opts);
/** Line chart with one series per value of `column`. */
const by = (title: string, metric: MetricRef, column: string, opts: WidgetOptions = {}) =>
  line(title, [q(metric, ["sum"], { columns: [column] })], opts);
/** Several metrics/filters as named series on one chart. */
const series = (title: string, entries: Array<[name: string, metric: MetricRef, aggregate?: string]>, opts?: WidgetOptions) =>
  line(title, entries.map(([name, metric, aggregate = "sum"]) => q(metric, [aggregate], { name })), opts);
const percentiles = (title: string, metric: MetricRef, opts: WidgetOptions = {}) =>
  line(title, [q(metric, ["p50", "p95"])], opts);

/** Flow the widgets into the 6-column grid, row by row. */
function layout(widgets: WidgetDraft[]): Widget[] {
  let x = 0;
  let y = 0;
  let rowH = 0;
  return widgets.map(({ _w, _h, ...rest }) => {
    if (x + _w > COLS) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const placed: Widget = { ...rest, layout: { x, y, w: _w, h: _h, minH: _h } };
    x += _w;
    rowH = Math.max(rowH, _h);
    return placed;
  });
}

// ───────────────────────────── dashboards ─────────────────────────────

const PRODUCT: WidgetDraft[] = [
  big("Active users", M("app.session.started"), "count_unique(user.id)", "Distinct users who started a session"),
  big("Sessions", M("app.session.started")),
  big("Messages sent", M("message.sent", "result:ok")),
  big("Calls joined", M("call.join", "result:ok")),
  big("Call minutes", M("call.duration"), (f) => `${f("sum")} / 60`),
  big("Sign-ins", M("auth.login", "result:ok")),

  by("Sessions by platform", M("app.session.started"), "platform", { w: 3 }),
  bars("Sessions by OS", M("app.session.started"), "os", "sum", { w: 3 }),
  by("Sign-ins by method", M("auth.login", "result:ok"), "method", { w: 3 }),
  bars("Sign-in failures by error", M("auth.login", "result:failed"), "error", "sum", { w: 3 }),
  area("Messages by kind", [q(M("message.sent", "result:ok"), ["sum"], { columns: ["kind"] })], { w: 3 }),
  series("Reactions", [["added", M("reaction.toggle", "action:add result:ok")], ["removed", M("reaction.toggle", "action:remove result:ok")]], { w: 3 }),
  by("Calls by mode", M("call.join", "result:ok"), "mode", { w: 3 }),
  percentiles("Spaces per user", M("space.membership.count"), { w: 3 }),
  series("Spaces joined / created", [["joined", M("space.joined", "result:ok")], ["created", M("space.created", "result:ok")]], { w: 3 }),
  bars("Invite failures by reason", M("space.joined", "result:failed"), "error", "sum", { w: 3 }),
  bars("Channels created by kind", M("channel.created"), "kind", "sum", { w: 2 }),
  bars("Invites by expiry", M("space.invite.created"), "expires", "sum", { w: 2 }),
  bars("Invites by use limit", M("space.invite.created"), "uses", "sum", { w: 2 }),
  bars("Activities by game", M("activity.start", "result:ok"), "game", "sum", { w: 2 }),
  big("Activity minutes", M("activity.duration"), (f) => `${f("sum")} / 60`),
  bars("Coming back after a nap", M("session.resume"), "slept", "sum", { w: 3, description: "How long the tab/app was asleep before it resumed" }),
  bars("Status changes", M("user.status.changed"), "status", "sum", { w: 2 }),
  bars("Locale switches", M("locale.changed"), "locale", "sum", { w: 2 }),
  series("Feedback / legal accepted", [["feedback", M("feedback.sent")], ["legal accepted", M("legal.accepted")]], { w: 2 }),
];

const CALLS: WidgetDraft[] = [
  big("Joins ok", M("call.join", "result:ok")),
  big("Joins failed", M("call.join", "result:failed")),
  big("Joins refused", M("call.join", "result:refused")),
  big("Time to connect p95 (ms)", M("call.join.duration"), "p95"),
  big("Call length p50 (min)", M("call.duration"), (f) => `${f("p50")} / 60`),
  big("Room size avg", M("call.room.size"), "avg"),

  by("Join outcome", M("call.join"), "result", { w: 3 }),
  bars("Join failures by stage", M("call.join", "result:failed"), "stage", "sum", { w: 3 }),
  percentiles("Time to connect (ms)", M("call.join.duration"), { w: 3 }),
  line("Time to connect p95 by platform", [q(M("call.join.duration"), ["p95"], { columns: ["platform"] })], { w: 3 }),
  percentiles("Call length p50 / p95 (s)", M("call.duration"), { w: 3 }),
  line("Room size avg / p95", [q(M("call.room.size"), ["avg", "p95"])], { w: 3 }),
  area("Connection quality", [q(M("call.quality"), ["sum"], { columns: ["quality"] })], { w: 3 }),
  bars("Call endings by reason", M("call.ended"), "reason", "sum", { w: 3 }),
  by("Unexpected disconnects by reason", M("call.disconnected"), "reason", { w: 3 }),
  series("Reconnects", [["reconnecting", M("call.reconnecting")], ["reconnected", M("call.reconnected")]], { w: 3 }),
  percentiles("Reconnect duration (ms)", M("call.reconnect.duration"), { w: 3 }),
  bars("TURN probe", M("call.turn.probe"), "result", "sum", { w: 3 }),
  by("Screen share starts", M("call.screenshare.start"), "result", { w: 2 }),
  big("Screen share p50 (min)", M("call.screenshare.duration"), (f) => `${f("p50")} / 60`),
  by("Camera starts", M("call.camera.start"), "result", { w: 2 }),
  big("Camera p50 (min)", M("call.camera.duration"), (f) => `${f("p50")} / 60`),
  series("Playback blocked / CPU constrained / audio device errors", [
    ["playback blocked", M("call.playback.blocked")],
    ["cpu constrained", M("call.cpu_constrained")],
    ["audio device error", M("call.audio_device.error")],
  ], { w: 3 }),
  bars("Track subscription failures", M("call.track.subscription_failed"), "reason", "sum", { w: 3 }),
  series("Direct calls", [
    ["outgoing", M("call.dm.outgoing")],
    ["incoming", M("call.dm.incoming")],
    ["accepted", M("call.dm.accepted")],
    ["rejected", M("call.dm.rejected")],
  ], { w: 4 }),
  big("Crash recoveries", M("call.crash_recovery")),
  big("Busy on incoming", M("call.dm.incoming", "busy:true")),
];

const RELIABILITY: WidgetDraft[] = [
  big("Boot p95 (s)", M("app.boot.duration"), (f) => `${f("p95")} / 1000`),
  big("Boot failures", M("app.boot", "result:failed")),
  big("Realtime outages", M("realtime.disconnected", "intentional:false")),
  big("Outage p95 (s)", M("realtime.outage.duration"), (f) => `${f("p95")} / 1000`),
  big("Full resyncs", M("realtime.resync.full")),
  big("Upload failures", M("attachment.upload", "result:failed")),

  percentiles("Boot duration (ms)", M("app.boot.duration"), { w: 3 }),
  by("Boot outcome", M("app.boot"), "result", { w: 3 }),
  bars("Boot steps p95 (ms)", M("app.boot.step.duration"), "step", "p95", { w: 4 }),
  bars("Boot attempt failures by error", M("app.boot.attempt_failed"), "error", "sum", { w: 2 }),
  series("Realtime disconnects", [
    ["unintentional", M("realtime.disconnected", "intentional:false")],
    ["manual retry", M("realtime.reconnect.manual")],
    ["reconnected", M("realtime.connected", "reconnect:true")],
  ], { w: 3 }),
  percentiles("Realtime outage duration (ms)", M("realtime.outage.duration"), { w: 3 }),
  percentiles("Reconnect attempts before success", M("realtime.reconnect.attempts"), { w: 3 }),
  bars("Session check by result", M("auth.session.check"), "result", "sum", { w: 3 }),
  by("Token refresh by result", M("auth.token.refresh"), "result", { w: 3 }),
  bars("Message send failures by error", M("message.sent", "result:failed"), "error", "sum", { w: 3 }),
  percentiles("Message send duration (ms)", M("message.send.duration", "result:ok"), { w: 3 }),
  line("Attachment upload p95 by kind (ms)", [q(M("attachment.upload.duration"), ["p95"], { columns: ["kind"] })], { w: 3 }),
  bars("Attachment size p50 by kind (MB)", M("attachment.bytes"), "kind", `equation|${F(M("attachment.bytes"), "p50")} / 1048576`, { w: 3 }),
  series("Background failures", [
    ["post-login init", M("app.post_login.failed")],
    ["realtime ticket", M("realtime.ticket.failed")],
    ["event decode", M("realtime.event.decode_failed")],
    ["worker error", M("realtime.worker.error")],
  ], { w: 3 }),
  by("Account switches", M("account.switch"), "mode", { w: 3 }),
  series("Resume with expired token", [
    ["token expired", M("session.resume", "token_expired:true")],
    ["token fine", M("session.resume", "token_expired:false")],
  ], { w: 3 }),
];

const ULTIMA: WidgetDraft[] = [
  big("Checkouts started", M("ultima.checkout")),
  big("Checkouts ok", M("ultima.checkout", "result:ok")),
  big("Subscribers seen", M("ultima.subscription.state", "status:Active"), "count_unique(user.id)", "Distinct users whose session reported an active subscription"),
  big("Boost packs bought", M("ultima.boost_pack.purchase", "result:ok")),
  big("Gifts sent", M("ultima.gift", "result:ok")),
  big("Cancellations", M("ultima.subscription.cancel", "result:ok")),

  bars("Subscription state at session start", M("ultima.subscription.state"), "status", "sum", { w: 3 }),
  line("Subscribers by platform", [q(M("ultima.subscription.state", "status:Active"), ["count_unique(user.id)"], { columns: ["platform"] })], { w: 3 }),
  by("Checkouts by plan", M("ultima.checkout", "result:ok"), "plan", { w: 3 }),
  bars("Checkout failures by error", M("ultima.checkout", "result:failed"), "error", "sum", { w: 3 }),
  by("Boost actions", M("ultima.boost", "result:ok"), "action", { w: 3 }),
  bars("Boost failures by error", M("ultima.boost", "result:failed"), "error", "sum", { w: 3 }),
  bars("Boost packs by pack", M("ultima.boost_pack.purchase", "result:ok"), "pack", "sum", { w: 3 }),
  bars("Gifts by plan", M("ultima.gift", "result:ok"), "plan", "sum", { w: 3 }),
  series("Gifts with / without a message", [["with message", M("ultima.gift", "result:ok with_message:true")], ["without", M("ultima.gift", "result:ok with_message:false")]], { w: 3 }),
  series("Cancellations", [["cancelled", M("ultima.subscription.cancel", "result:ok")]], { w: 3 }),
];

const DASHBOARDS: Dashboard[] = (
  [
    ["Argon · Product", PRODUCT],
    ["Argon · Calls", CALLS],
    ["Argon · Reliability", RELIABILITY],
    ["Argon · Ultima", ULTIMA],
  ] as const
).map(([title, widgets]) => ({
  title,
  widgets: layout([...widgets]),
  projects: [PROJECT],
  period: "7d",
  environment: [],
  filters: {},
}));

// ───────────────────────────── API ─────────────────────────────

interface ApiResult {
  status: number;
  json: unknown;
}

async function api(token: string, method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON: keep the text */
  }
  return { status: res.status, json };
}

async function create(token: string, only: string | undefined): Promise<void> {
  const existing = await api(token, "GET", `/organizations/${ORG}/dashboards/`);
  if (existing.status !== 200 || !Array.isArray(existing.json)) {
    throw new Error(`listing dashboards failed: HTTP ${existing.status} ${JSON.stringify(existing.json).slice(0, 300)}`);
  }
  const current = existing.json as Array<{ id: string; title: string }>;

  for (const dashboard of DASHBOARDS) {
    if (only && !dashboard.title.includes(only)) continue;

    for (const old of current.filter((x) => x.title === dashboard.title)) {
      const del = await api(token, "DELETE", `/organizations/${ORG}/dashboards/${old.id}/`);
      console.log(`replaced old "${old.title}" (${old.id}): HTTP ${del.status}`);
    }

    const res = await api(token, "POST", `/organizations/${ORG}/dashboards/`, dashboard);
    if (res.status >= 300) {
      console.error(`FAILED "${dashboard.title}": HTTP ${res.status}\n${JSON.stringify(res.json, null, 2).slice(0, 3000)}`);
      process.exitCode = 1;
      continue;
    }
    const id = (res.json as { id: string }).id;
    console.log(`created "${dashboard.title}": https://sentry.argon.gl/organizations/${ORG}/dashboard/${id}/  (${dashboard.widgets.length} widgets)`);
  }
}

// ───────────────────────────── main ─────────────────────────────

if (has("--dry")) {
  for (const d of DASHBOARDS) console.log(`${d.title}: ${d.widgets.length} widgets`);
  const sample = DASHBOARDS[1].widgets.find((w) => w.title === "Screen share starts");
  console.log(JSON.stringify(sample, null, 2));
} else if (has("--create")) {
  const token = process.env.SENTRY_AUTH_TOKEN?.trim();
  if (!token) {
    console.error("SENTRY_AUTH_TOKEN is not set (needs org:read, org:write, project:read)");
    process.exit(2);
  }
  await create(token, after("--only"));
} else {
  console.log("usage: bun run sentry:dashboards -- --dry | --create [--only <title part>]");
  process.exit(2);
}

// Top-level await needs a module.
export {};
