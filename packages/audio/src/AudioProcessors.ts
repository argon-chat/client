/** The shared graph/parameter/message surface used by browser and native processors. */
export interface AudioProcessorNode extends AudioNode {
  readonly parameters: ReadonlyMap<string, AudioParam>;
  readonly port: Pick<MessagePort, "onmessage" | "close">;
}

export type NativeAudioProcessorName =
  | "peak-meter-stereo"
  | "peak-meter-mono"
  | "stereo-to-mono"
  | "input-gate";

/** Application processor ids are mapped here, never built into the public native SDK. */
const NATIVE_PROCESSORS: Readonly<Record<string, NativeAudioProcessorName>> = {
  "vu-meter-processor": "peak-meter-stereo",
  "vu-meter-light": "peak-meter-mono",
  "vu-stereo-to-mono-processor": "stereo-to-mono",
  "input-gate-processor": "input-gate",
};

export const isNativeAudioRuntime = (): boolean =>
  (globalThis as { isVn?: unknown }).isVn === true;

type NativeAudioContext = AudioContext & {
  loadNativeAudioWorklet?: (
    name: NativeAudioProcessorName,
    options?: AudioWorkletNodeOptions,
  ) => AudioProcessorNode;
};

/** Validate native capability before accepting module registration or creating a node. */
export function nativeProcessorName(ctx: AudioContext, workletId: string): NativeAudioProcessorName {
  const name = Object.hasOwn(NATIVE_PROCESSORS, workletId) ? NATIVE_PROCESSORS[workletId] : undefined;
  if (!name) throw new Error(`[AudioManagement] No native audio processor for: ${workletId}`);
  if (typeof (ctx as NativeAudioContext).loadNativeAudioWorklet !== "function") {
    throw new Error("[AudioManagement] This vue-native runtime does not support loadNativeAudioWorklet");
  }
  return name;
}

/** Native DSP is compiled into the host; browser processors continue loading their JS modules. */
export function createAudioProcessor(
  ctx: AudioContext,
  workletId: string,
  options?: AudioWorkletNodeOptions,
): AudioProcessorNode {
  if (isNativeAudioRuntime()) {
    const name = nativeProcessorName(ctx, workletId);
    return (ctx as NativeAudioContext).loadNativeAudioWorklet!(name, options);
  }
  return new AudioWorkletNode(ctx, workletId, options);
}
