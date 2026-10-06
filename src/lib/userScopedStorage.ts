// Per-account namespacing for user-scoped localStorage keys.
//
// Multi-account: data that belongs to a specific signed-in user (recent spaces, server folders,
// preferred status, per-user volumes, chat preferences such as video autoplay and the video player's
// volume, mute and speed) must not bleed across accounts. We suffix those keys with the active account
// id. Device/app preferences (audio/video devices, hotkeys, locale, overlay, dashboard layout,
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
  "argon_recent_stickers",
  "argon_recent_emoji",
  "argon_recent_emoji_picker",
  "argon_expression_animations",
  "argon_expression_picker_autoplay",
  "argon_emoji_usage",
  "argon_emoji_suggestions",
  "argon_emoji_suggest",
  "argon_emoji_replace_emoticons",
  "argon_emoji_suggest_custom",
  "argon_emoji_suggest_stickers",
  "argon_bot_motd_hidden",
  "argon_video_autoplay",
  "argon_video_autoplay_max_bytes",
  "argon_video_loop_short",
  "argon_video_volume",
  "argon_video_muted",
  "argon_video_rate",
  "argon_video_upload_quality",
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

/**
 * Forgets everything scoped to the account that is signing out.
 *
 * The database is the visible half of a leaked session; this is the rest of it — recent spaces, the
 * last channel per space, folder layout, preferred status, per-user volumes. `removeAccount` clears
 * exactly these when a multi-account entry goes away, and the browser build has no entry to remove,
 * so it has to ask for the same thing directly.
 */
export function clearUserScopedKeys(): void {
  const id = activeAccountId();

  for (const base of USER_SCOPED_BASE_KEYS) {
    try { localStorage.removeItem(`${base}::${id}`); } catch { /* nothing to remove */ }
  }
}
