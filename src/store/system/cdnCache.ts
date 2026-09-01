import { persistedValue } from "@argon/storage";

/**
 * Whether media is served through Argon's own cache, or fetched from the CDN every time.
 *
 * On by default, and normally there is no reason to touch it: the desktop app keeps files on disk
 * under `app://cdn`, the browser build keeps them in a storage bucket behind a service worker, and
 * both exist because a file's bytes never change once it has an id.
 *
 * Turning it off is a diagnostic instrument. When a picture is wrong — stale, missing, belonging to
 * someone else — there is no way to tell from the outside whether the CDN answered that way or a
 * cache did, and every layer between the two makes the question harder. Off, there are no layers:
 * every request goes straight to `{api}/files/{fileId}`, so whatever appears on screen is what the
 * server actually sent.
 *
 * Lives apart from both cache implementations so each can read it without depending on the other.
 */
export const cdnCacheEnabled = persistedValue<boolean>("storage.cdnCacheEnabled", true);
