import { createApp, h, nextTick, onMounted, shallowRef } from "vue";
import { createLocalScreenTracks, createLocalVideoTrack, type LocalVideoTrack } from "livekit-client";
import { useVideoTrackAttach } from "../../../src/composables/useVideoTrackAttach";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForPlayback(element: HTMLVideoElement, width: number, height: number, previousSource = "") {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    const source = element.getAttribute("src") ?? "";
    if (source.startsWith("sk-stream://") && source !== previousSource &&
        element.videoWidth === width && element.videoHeight === height && element.readyState >= 2) {
      const time = element.currentTime;
      await sleep(250);
      if (!element.paused && element.currentTime > time && element.getAttribute("src") === source) return source;
    }
    await sleep(40);
  }
  throw Error(`Tile failed to play a new ${width}×${height} stream: src=${element.getAttribute("src")} size=${element.videoWidth}×${element.videoHeight} readyState=${element.readyState} paused=${element.paused} currentTime=${element.currentTime}`);
}

createApp({
  setup() {
    const cameraElement = shallowRef<HTMLVideoElement | null>(null);
    const screenElement = shallowRef<HTMLVideoElement | null>(null);
    const camera = shallowRef<LocalVideoTrack>();
    const screen = shallowRef<LocalVideoTrack>();
    useVideoTrackAttach(cameraElement, () => camera.value);
    useVideoTrackAttach(screenElement, () => screen.value);

    onMounted(async () => {
      const tracks: LocalVideoTrack[] = [];
      try {
        const cameraNode = cameraElement.value!;
        const screenNode = screenElement.value!;
        let cameraSource = "";
        let screenSource = "";
        // Simulate republishing both tracks while the call UI retains the same tiles.
        for (let publication = 0; publication < 2; publication++) {
          camera.value = await createLocalVideoTrack({ resolution: { width: 160, height: 96, frameRate: 12 } });
          tracks.push(camera.value);
          const screenTracks = await createLocalScreenTracks({ audio: false, resolution: { width: 192, height: 112, frameRate: 12 } });
          const video = screenTracks.find((track): track is LocalVideoTrack => track.kind === "video");
          if (!video) throw Error("Missing screen video track");
          screen.value = video;
          tracks.push(video);
          [cameraSource, screenSource] = await Promise.all([
            waitForPlayback(cameraNode, 160, 96, cameraSource),
            waitForPlayback(screenNode, 192, 112, screenSource),
          ]);
          if (cameraSource === screenSource) throw Error("The tiles share a capture");
          console.log("[aot-call-video] playing", cameraSource, screenSource);
        }
        camera.value = undefined;
        screen.value = undefined;
        await nextTick();
        if (cameraNode.getAttribute("src") || screenNode.getAttribute("src")) throw Error("A removed track is still attached");
        console.log("[aot-call-video] passed");
      } catch (error) {
        console.error("[aot-call-video] failed", String(error));
      } finally {
        for (const track of tracks) track.stop();
      }
    });
    return () => h("div", [
      h("video", { ref: cameraElement, style: { width: 160, height: 96 } }),
      h("video", { ref: screenElement, style: { width: 192, height: 112 } }),
    ]);
  },
}).mount("#app");
