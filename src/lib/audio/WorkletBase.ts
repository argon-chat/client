import {
  type DeepReadonly,
  onBeforeUnmount,
  readonly,
  ref,
  type Ref,
} from "vue";
import { Disposable } from "../disposables";
import { logger } from "../logger";
import type { BehaviorSubject } from "rxjs";
import { audio } from "./AudioManager";

export class WorkletBase {
  #inited = false;

  async init(): Promise<void> {
    if (this.#inited) return;
    await audio.addWorkletModule(
      "/audio/vu-meter-processor.js",
      "vu-meter-processor",
    );
    await audio.addWorkletModule(
      "/audio/vu-stm.js",
      "vu-stereo-to-mono-processor",
    );
    this.#inited = true;
  }

  useSubjectAsRef<T>(
    subject: BehaviorSubject<T>,
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
    rightRef: Ref<number>,
  ): Promise<Disposable<AudioWorkletNode>> {
    const vuNode = new AudioWorkletNode(
      audio.getCurrentAudioContext(),
      "vu-meter-processor",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "discrete",
      },
    );

    vuNode.port.onmessage = (event) => {
      const { left, right } = event.data;
      leftRef.value = audio.volumeToPercent(left);
      rightRef.value = audio.volumeToPercent(right);
    };

    const disposable = new Disposable<AudioWorkletNode>(
      vuNode,
      async (node) => {
        logger.warn("Node disconnected", node);
        node.port.close();
        node.disconnect();
      },
    );

    return disposable;
  }

  async createStereoToMonoProcessor(): Promise<Disposable<AudioWorkletNode>> {
    const stmNode = new AudioWorkletNode(
      audio.getCurrentAudioContext(),
      "vu-stereo-to-mono-processor",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      },
    );

    const disposable = new Disposable<AudioWorkletNode>(
      stmNode,
      async (node) => {
        logger.warn("Node disconnected", node);
        node.port.close();
        node.disconnect();
      },
    );

    return disposable;
  }

  setEnabledVUNode(node: AudioWorkletNode, isEnabled: boolean) {
    logger.info("set vu node settings, enabled ", isEnabled ? 1.0 : 0.0);
    node.parameters
      .get("enabled")
      ?.setValueAtTime(
        isEnabled ? 1.0 : 0.0,
        audio.getCurrentAudioContext().currentTime,
      );
  }
}

const worklets = new WorkletBase();

export { worklets };
