/** The SDK launch queue delivers the initial and subsequent OS protocol activations. */

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
