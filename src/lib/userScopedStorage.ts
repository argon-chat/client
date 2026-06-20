// Per-account namespacing for user-scoped localStorage keys.
//
// Multi-account: data that belongs to a specific signed-in user (recent spaces, server folders,
// preferred status, per-user volumes) must not bleed across accounts. We suffix those keys with the
// active account id. Device/app preferences (audio/video, hotkeys, locale, overlay, dashboard layout,
// api_endpoint) intentionally stay GLOBAL and are NOT namespaced.
//
// The active id is read straight from localStorage (no store import) so this stays cycle-free and
// usable from plain modules. Because switching accounts reloads the page, reading it at module-load
// is always correct.

/** The user-scoped base keys, kept here so account removal/migration can enumerate them. */
export const USER_SCOPED_BASE_KEYS = [
  "argon_recent_spaces",
  "argon_recent_spaces_view",
  "argon_last_channels",
  "argon_server_organization",
  "preferredStatus",
  "userVolumes_v2",
] as const;

export function activeAccountId(): string {
  try {
    const id = localStorage.getItem("argon_active_account");
    if (id && /^[a-z0-9-]+$/.test(id)) return id;
  } catch {}
  return "default";
}

/** `base` namespaced to the active account, e.g. `argon_recent_spaces::api-argon-gl-7f3c…`. */
export function userScopedKey(base: string): string {
  return `${base}::${activeAccountId()}`;
}
