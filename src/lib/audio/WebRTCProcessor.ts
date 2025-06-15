import { usePreference } from "@/store/preferenceStore";
import type {
  AudioProcessorOptions,
  Room,
  Track,
  TrackProcessor,
} from "livekit-client";
import { DisposableBag } from "../disposables";
import type { IAudioManagement } from "./AudioManager";
import { worklets } from "./WorkletBase";

export class WebRTCProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  private bag: DisposableBag = new DisposableBag();
  private worklets: AudioWorkletNode[];
  private audio: IAudioManagement;
  constructor(audio: IAudioManagement) {
    this.worklets = [];
    this.audio = audio;
  }

  name = "audio-processor";
  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track } = opts;

    const prefs = usePreference();

    const sub = prefs.onforceToMonoChanged.subscribe((x) => {
      for (const element of this.worklets) {
        if (element.parameters.has("enabled")) {
          worklets.setEnabledVUNode(element, x);
        }
      }
    });

    this.bag.addSubscription(sub);

    const w1 = (await worklets.createStereoToMonoProcessor()).injectInto(
      this.bag,
    );

    worklets.setEnabledVUNode(w1, prefs.forceToMono);

    this.worklets = [w1];

    const inputStream = new MediaStream([track]);
    const sourceNode = new MediaStreamAudioSourceNode(
      this.audio.getCurrentAudioContext(),
      {
        mediaStream: inputStream,
      },
    );
    sourceNode.connect(this.worklets[0]);

    for (let i = 0; i < this.worklets.length - 1; i++) {
      this.worklets[i].connect(this.worklets[i + 1]);
    }

    const destinationNode = new MediaStreamAudioDestinationNode(
      this.audio.getCurrentAudioContext(),
      {
        channelCount: 2,
      },
    );

    this.worklets[this.worklets.length - 1].connect(destinationNode);
    const trackOut = destinationNode.stream.getAudioTracks()[0];

    this.processedTrack = trackOut;
  }
  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }
  async destroy(): Promise<void> {
    await this.bag.asyncDispose();
    if (this.processedTrack) {
      this.processedTrack.stop();
      this.processedTrack = undefined;
    }
  }

  processedTrack?: MediaStreamTrack | undefined;
  onPublish?: ((room: Room) => Promise<void>) | undefined;
  onUnpublish?: (() => Promise<void>) | undefined;
}
