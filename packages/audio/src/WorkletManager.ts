import {
  type DeepReadonly,
  onBeforeUnmount,
  readonly,
  ref,
  type Ref,
} from "vue";
import { Disposable, logger } from "@argon/core";
import type { BehaviorSubject } from "rxjs";
import type { IAudioManagement } from "./AudioManager";

export class WorkletManager {
  #inited = false;
  #audio: IAudioManagement;

  constructor(audio: IAudioManagement) {
    this.#audio = audio;
  }

  async init(): Promise<void> {
    if (this.#inited) return;
    const basePath = (this.#audio as any).workletBasePath ?? '/audio';
    await this.#audio.addWorkletModule(
      `${basePath}/vu-meter-processor.js`,
      "vu-meter-processor"
    );
    await this.#audio.addWorkletModule(
      `${basePath}/vu-stm.js`,
      "vu-stereo-to-mono-processor"
    );
    this.#inited = true;
  }

  useSubjectAsRef<T>(
    subject: BehaviorSubject<T>
  ): Readonly<Ref<DeepReadonly<T>>> {
    const state = ref(subject.getValue()) as Ref<T>;

    const sub = subject.subscribe((value) => {
      state.value = value;
    });

    onBeforeUnmount(() => {
      sub.unsubscribe();
    });

    return readonly(state);
  }

  async createVUMeter(
    leftRef: Ref<number>,
    rightRef: Ref<number>
  ): Promise<Disposable<AudioWorkletNode>> {
    const vuNode = new AudioWorkletNode(
      this.#audio.getCurrentAudioContext(),
      "vu-meter-processor",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "discrete",
      }
    );

    vuNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const data = event.data;

      leftRef.value = this.#audio.volumeToPercent(data[0]);
      rightRef.value = this.#audio.volumeToPercent(data[1]);
    };

    const disposable = new Disposable<AudioWorkletNode>(
      vuNode,
      async (node) => {
        node.port.close();
        node.disconnect();
      }
    );

    return disposable;
  }

  async createStereoToMonoProcessor(): Promise<Disposable<AudioWorkletNode>> {
    const stmNode = new AudioWorkletNode(
      this.#audio.getCurrentAudioContext(),
      "vu-stereo-to-mono-processor",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      }
    );

    const disposable = new Disposable<AudioWorkletNode>(
      stmNode,
      async (node) => {
        node.port.close();
        node.disconnect();
      }
    );

    return disposable;
  }

  setEnabledVUNode(node: AudioWorkletNode, isEnabled: boolean) {
    node.parameters
      .get("enabled")
      ?.setValueAtTime(
        isEnabled ? 1.0 : 0.0,
        this.#audio.getCurrentAudioContext().currentTime
      );
  }
}
