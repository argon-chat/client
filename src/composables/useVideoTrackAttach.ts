import { onUnmounted } from "vue";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";

/** The two calls a LiveKit track exposes for binding it to a media element. */
type Attachable = {
  attach(el: HTMLMediaElement): unknown;
  detach(el: HTMLMediaElement): unknown;
};

/**
 * Binds the `<video>` elements that ParticipantCards render to the tracks in the call
 * store. One instance per component that renders tiles: every element it attached is
 * detached again when that component unmounts.
 *
 * The track is remembered next to the element on purpose. A tile's `<video>` unmounts
 * *because* its track left the store, so looking the track up again at that point finds
 * nothing and the element would stay in the track's attached list forever.
 */
export function useVideoTrackAttach() {
  const voice = useUnifiedCall();
  const attached = new Map<string, { el: HTMLVideoElement; track: Attachable }>();

  /** `@video-ref` handler for a ParticipantCard: `el` is the element, or null on unmount. */
  const setVideoRef = (el: unknown, userId: string, source = "camera") => {
    const key = voice.videoTrackKey(userId, source);
    const previous = attached.get(key);

    if (el instanceof HTMLVideoElement) {
      if (previous?.el === el) return;
      if (previous) previous.track.detach(previous.el);
      const track = voice.videoTracks.get(key) as Attachable | undefined;
      if (!track) {
        attached.delete(key);
        return;
      }
      track.attach(el);
      attached.set(key, { el, track });
      return;
    }

    if (el === null && previous) {
      previous.track.detach(previous.el);
      attached.delete(key);
    }
  };

  onUnmounted(() => {
    for (const { el, track } of attached.values()) track.detach(el);
    attached.clear();
  });

  return { setVideoRef };
}
