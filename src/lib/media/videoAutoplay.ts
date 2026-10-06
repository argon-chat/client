import { AnimationIntersector, type AnimationControl } from "@/lib/expressions/animationIntersector";
import { videoAutoplayActive } from "@/lib/video/playerSettings";

/**
 * Chat videos play through an intersector of their own: like stickers they play only while on
 * screen and while the tab is visible, but under the video switch instead of the sticker one.
 * It is made for the first autoplaying video and destroyed with the last, so with autoplay off
 * nothing observes anything and no listener is left on the document.
 */

let shared: AnimationIntersector | null = null;
let users = 0;
/** Open viewers (split view can hold two chats): while any is open, no chat preview plays. */
let suspensions = 0;
const NO_GROUP = "none";

export interface AutoplayVideoControl {
  readonly playing: boolean;
  readonly visible: boolean;
  remove(): void;
}

export function addAutoplayVideo(el: Element, setPlaying: (playing: boolean) => void): AutoplayVideoControl {
  if (!shared) {
    shared = new AnimationIntersector({ animationsEnabled: videoAutoplayActive, groupAutoplay: {} });
    if (suspensions > 0) shared.setOnlyPlayableGroup(NO_GROUP);
  }
  users++;
  const control: AnimationControl = shared.add({ el, group: "chat-video", autoplay: true, setPlaying });
  let removed = false;
  return {
    get playing() {
      return control.playing;
    },
    get visible() {
      return control.visible;
    },
    remove() {
      if (removed) return;
      removed = true;
      control.remove();
      if (--users === 0) {
        shared?.destroy();
        shared = null;
      }
    },
  };
}

/** The viewer opened (true) or closed (false): the chat's previews pause behind it and resume after. */
export function suspendChatVideos(suspend: boolean): void {
  suspensions = Math.max(0, suspensions + (suspend ? 1 : -1));
  shared?.setOnlyPlayableGroup(suspensions > 0 ? NO_GROUP : null);
}

/** Tests: whether the intersector exists at all. */
export function autoplayIntersectorAlive(): boolean {
  return shared !== null;
}
