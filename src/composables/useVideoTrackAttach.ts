import { toRaw, watch, type Ref } from "vue";

export interface AttachableVideoTrack {
  attach(element: HTMLVideoElement): unknown;
  detach(element: HTMLVideoElement): unknown;
}

/** A camera restart or a resubscription can replace the track while the tile keeps its element. */
export function useVideoTrackAttach(
  video: Readonly<Ref<HTMLVideoElement | null>>,
  getTrack: () => AttachableVideoTrack | undefined,
): void {
  watch([video, getTrack], ([element, track], _, onCleanup) => {
    if (!element || !track) return;
    const publicationTrack = toRaw(track);
    publicationTrack.attach(element);
    onCleanup(() => publicationTrack.detach(element));
  }, { flush: "post", immediate: true });
}
