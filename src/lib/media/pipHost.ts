/**
 * "Continue in picture-in-picture" (tweb's term): a video in PiP whose player goes away — the viewer
 * closed — moves into a hidden host on <body> and keeps playing there. Leaving PiP stops it and lets
 * the element and its buffers go. The host exists only while it holds a video.
 */

let host: HTMLDivElement | null = null;
const kept = new Set<HTMLVideoElement>();

/** Adopts `video` when it is the PiP element; false (and nothing done) otherwise. */
export function continueInPictureInPicture(video: HTMLVideoElement): boolean {
  if (typeof document === "undefined" || document.pictureInPictureElement !== video) return false;
  if (!host) {
    host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.dataset.testid = "pip-host";
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      visibility: "hidden",
      pointerEvents: "none",
    });
    document.body.appendChild(host);
  }
  // One move (appendChild detaches and inserts in the same task), so the element never leaves the
  // document and is not paused on the way.
  host.appendChild(video);
  kept.add(video);
  video.addEventListener("leavepictureinpicture", () => release(video), { once: true });
  return true;
}

/** A new video is about to play: the one left playing in PiP stops. */
export function stopContinuedPictureInPicture(): void {
  if (typeof document === "undefined") return;
  const current = document.pictureInPictureElement;
  if (current instanceof HTMLVideoElement && kept.has(current)) void document.exitPictureInPicture().catch(() => release(current));
}

export function hasContinuedPictureInPicture(): boolean {
  return kept.size > 0;
}

function release(video: HTMLVideoElement) {
  if (!kept.delete(video)) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.remove();
  if (!kept.size) {
    host?.remove();
    host = null;
  }
}
