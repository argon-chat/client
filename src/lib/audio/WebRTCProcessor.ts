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
  private workletNodes: AudioWorkletNode[] = [];
  private audio: IAudioManagement;
  private sourceNode?: MediaStreamAudioSourceNode;
  private destinationNode?: MediaStreamAudioDestinationNode;

  constructor(audio: IAudioManagement) {
    this.audio = audio;
  }

  name = "audio-processor";

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track } = opts;

    if (!track) {
      throw new Error("[WebRTCProcessor] Track is required for initialization");
    }

    const prefs = usePreference();

    const sub = prefs.onforceToMonoChanged.subscribe((x) => {
      for (const element of this.workletNodes) {
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

    this.workletNodes = [w1];

    await this.setupAudioPipeline(track);
  }

  private async setupAudioPipeline(track: MediaStreamTrack): Promise<void> {
    const ctx = this.audio.getCurrentAudioContext();

    const inputStream = new MediaStream([track]);
    this.sourceNode = new MediaStreamAudioSourceNode(ctx, {
      mediaStream: inputStream,
    });

    this.destinationNode = new MediaStreamAudioDestinationNode(ctx, {
      channelCount: 2,
    });

    // Connect source to first worklet
    this.sourceNode.connect(this.workletNodes[0]);

    // Connect worklets in chain using AudioManager's method
    this.audio.workletBranchByOrderConnect(this.workletNodes);

    // Connect last worklet to destination
    this.workletNodes[this.workletNodes.length - 1].connect(this.destinationNode);

    const trackOut = this.destinationNode.stream.getAudioTracks()[0];
    if (!trackOut) {
      throw new Error("[WebRTCProcessor] Failed to create output track");
    }

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

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = undefined;
    }

    if (this.destinationNode) {
      this.destinationNode.disconnect();
      this.destinationNode = undefined;
    }

    this.workletNodes = [];
  }

  processedTrack?: MediaStreamTrack | undefined;
  onPublish?: ((room: Room) => Promise<void>) | undefined;
  onUnpublish?: (() => Promise<void>) | undefined;
}
