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
    await this.#audio.addWorkletModule(
      `${basePath}/input-gate-processor.js`,
      "input-gate-processor"
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
    const ctx = this.#audio.getCurrentAudioContext();
    if (!ctx.audioWorklet) return this.#analyserVUMeter(ctx, leftRef, rightRef);

    const vuNode = new AudioWorkletNode(
      ctx,
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

  /**
   * The VU meter of an AudioContext with no AudioWorklet (vue-native today): an AnalyserNode per
   * channel, read 60 times a second, through the worklet's own peak envelope (vu-meter-processor.js:
   * attack 0.15 and release 0.85 per 128-frame block, here per tick). The node returned is the input.
   * vue-native's research/reports/m26/client-gap.md §4, "the gate/VU worklets".
   */
  #analyserVUMeter(ctx: AudioContext, leftRef: Ref<number>, rightRef: Ref<number>): Disposable<AudioWorkletNode> {
    const TICKS_PER_SECOND = 60;
    // The worklet's release per block, compounded over the blocks one tick spans.
    const release = 0.85 ** (ctx.sampleRate / 128 / TICKS_PER_SECOND);
    const splitter = ctx.createChannelSplitter(2);
    const analysers = [0, 1].map((channel) => {
      const analyser = ctx.createAnalyser();
      // At least a tick's worth of samples, so no peak falls between two reads.
      analyser.fftSize = 1024;
      splitter.connect(analyser, channel);
      return analyser;
    });
    const samples = new Float32Array(1024);
    const envelope = [0, 0];
    const timer = setInterval(() => {
      analysers.forEach((analyser, channel) => {
        analyser.getFloatTimeDomainData(samples);
        let peak = 0;
        for (const v of samples) peak = Math.max(peak, Math.abs(v));
        envelope[channel] = envelope[channel] * release + peak * (1 - release);
      });
      leftRef.value = this.#audio.volumeToPercent(envelope[0]);
      rightRef.value = this.#audio.volumeToPercent(envelope[1]);
    }, 1000 / TICKS_PER_SECOND);

    return new Disposable<AudioWorkletNode>(splitter as unknown as AudioWorkletNode, async () => {
      clearInterval(timer);
      splitter.disconnect();
      for (const analyser of analysers) analyser.disconnect();
    });
  }

  async createStereoToMonoProcessor(): Promise<Disposable<AudioWorkletNode>> {
    const ctx = this.#audio.getCurrentAudioContext();
    if (!ctx.audioWorklet) {
      // No AudioWorklet (vue-native today): a pass-through, so the meter and the monitor still hear
      // the input. Force-to-mono is not previewed here. client-gap.md §4, "the gate/VU worklets".
      const through = ctx.createGain();
      return new Disposable<AudioWorkletNode>(through as unknown as AudioWorkletNode, async (node) => node.disconnect());
    }

    const stmNode = new AudioWorkletNode(
      ctx,
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
    // The pass-through createStereoToMonoProcessor gives without AudioWorklet has no parameters.
    node.parameters
      ?.get("enabled")
      ?.setValueAtTime(
        isEnabled ? 1.0 : 0.0,
        this.#audio.getCurrentAudioContext().currentTime
      );
  }
}
