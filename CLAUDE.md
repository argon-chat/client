# Argon client — instructions for agents

## Product metrics and Sentry dashboards (mandatory)

The client reports product metrics through Sentry trace metrics. The rules below are not optional;
follow them in the same change, not "later".

- **Every metric goes through `src/lib/telemetry/metrics.ts`.** Never call `Sentry.metrics.*` from
  feature code. Names are dotted and domain-first (`call.join`, `message.sent`); attributes are
  low-cardinality labels only (a mode, a result, `errorKind(e)`, a `bucket()`), never ids, messages or
  free text. Failure paths record the same metric with `result: "failed"` and an `error` kind. A
  metric's unit is part of its identity: never change it in place, rename the metric instead.
  Packages that cannot import the app (e.g. `packages/calls`) take an injected telemetry sink.
- **A new, renamed or removed metric must be reflected on a Sentry dashboard in the same session.**
  The dashboards are code: `scripts/sentry/dashboards.ts`. Register the metric in its `METRICS`
  catalogue (type + unit exactly as sent), add or change the widget(s), then re-create the affected
  dashboard:

  ```
  bun run sentry:dashboards -- --dry
  SENTRY_AUTH_TOKEN=… bun run sentry:dashboards -- --create --only <Product|Calls|Reliability|Ultima>
  ```

- **Ask the user for the token.** The script needs `SENTRY_AUTH_TOKEN` with scopes `org:read`,
  `org:write`, `project:read`. Do not search the repo or the machine for one; do not write it into any
  file under the repo; do not print it or put it in a commit. If the user cannot provide it right
  now, still add the widgets and state plainly in your report that the dashboard was not re-created
  and which command does it.
- Verify after re-creating: open the printed link and confirm the new widget shows data and that
  "Edit widget" shows the right metric in the series picker. Put the dashboard link in your report.
- Metrics and dashboards are internal: no entry in the root CHANGELOG.md.

The global skill `sentry-metrics-dashboards` has the widget encoding the editor expects, the
server's validator constraints, the query syntax and the demo-data procedure. Load it before touching
metrics or dashboards.

Sentry: https://sentry.argon.gl, org `argon`, project `argon-client` (id 22). Dashboards:
Product `/dashboard/7/`, Calls `/dashboard/8/`, Reliability `/dashboard/9/`, Ultima `/dashboard/10/`
(ids change when a dashboard is re-created; the script prints the new link — update this list).
