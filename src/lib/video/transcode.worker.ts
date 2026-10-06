// Video preparation worker: runs one mediabunny Conversion off the page's thread and posts the MP4
// back. WebCodecs is available here as on the page; the AAC polyfill is registered in this realm.

import { convertVideo, describeMp4 } from "./convert";
import { VideoPrepareError } from "./errors";
import type { TranscodeFromWorker, TranscodeToWorker } from "./protocol";

interface WorkerScope {
  postMessage(message: TranscodeFromWorker, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<TranscodeToWorker>) => void): void;
}

const scope = self as unknown as WorkerScope;
const controller = new AbortController();
const post = (message: TranscodeFromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

scope.addEventListener("message", async (event) => {
  const message = event.data;
  if (message.type === "cancel") {
    controller.abort();
    return;
  }

  post({ type: "started" });
  try {
    const buffer = await convertVideo(message.file, message.plan, {
      signal: controller.signal,
      videoCodec: message.videoCodec,
      onProgress: (fraction) => post({ type: "progress", fraction }),
    });
    const description = await describeMp4(buffer);
    post({ type: "done", buffer, description }, [buffer]);
  } catch (e) {
    post({
      type: "error",
      code: e instanceof VideoPrepareError ? e.code : "conversion-failed",
      message: e instanceof Error ? e.message : String(e),
    });
  }
});
