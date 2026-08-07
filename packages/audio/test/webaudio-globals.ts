/**
 * Minimal Web Audio globals, installed before any test module is imported.
 *
 * happy-dom implements no Web Audio at all, and libraries in this tree subclass
 * `AudioWorkletNode` at module scope — that runs on import, long before a test body can
 * stub anything. These are deliberately inert placeholders: tests that care about audio
 * behaviour replace them with recording fakes of their own.
 */

class AudioNodeStub {
  connect(target: unknown) { return target; }
  disconnect() {}
}

interface AudioParamStub {
  value: number;
  setValueAtTime(value: number): void;
  setTargetAtTime(value: number): void;
}

class AudioWorkletNodeStub extends AudioNodeStub {
  port = { onmessage: null, close() {}, postMessage() {} };
  parameters = new Map<string, AudioParamStub>();
}

class AudioContextStub extends AudioNodeStub {
  sampleRate = 48000;
  state = "running";
  currentTime = 0;
  destination = new AudioNodeStub();
  audioWorklet = { addModule: async () => {} };
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

for (const [name, value] of [
  ["AudioNode", AudioNodeStub],
  ["AudioWorkletNode", AudioWorkletNodeStub],
  ["AudioContext", AudioContextStub],
  ["MediaStreamAudioSourceNode", AudioNodeStub],
  ["MediaStreamAudioDestinationNode", AudioNodeStub],
] as const) {
  if (!(name in globalThis)) {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
}
