/**
 * `argon://` links under vue-native: its Launch Handler API, `launchQueue`, in place of Electron's
 * `argonDeepLink` bridge. This process's own launch is delivered first (buffered until a consumer is
 * set), then each launch a second process forwards to this one (vue-native docs/LAUNCH.md §1).
 * vue-native's research/reports/m26/client-gap.md §4, "launchQueue URLs → handleDeepLink"
 * (client-gap/A-webapi.md #94).
 *
 * A link is untrusted input, like any argv: only its string goes on, and handleDeepLink accepts
 * nothing but the routes it knows.
 */

interface LaunchQueueLike {
  setConsumer(consumer: (params: { targetURL?: string | null }) => void): void;
}

/** Hands every launch's link to `open`. Says so once when the host has no launchQueue. */
export function forwardLaunchLinks(open: (url: string) => void): void {
  const queue = (globalThis as { launchQueue?: Partial<LaunchQueueLike> }).launchQueue;
  if (typeof queue?.setConsumer !== "function") {
    console.warn("[vue-native] no launchQueue here: argon:// links will not reach the app");
    return;
  }
  queue.setConsumer((params) => {
    const url = params?.targetURL;
    if (typeof url === "string" && url) open(url);
  });
}
