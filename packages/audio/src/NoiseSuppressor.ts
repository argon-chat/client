import { logger } from "@argon/core";
import {
  RnnoiseWorkletNode,
  SpeexWorkletNode,
  NoiseGateWorkletNode,
  loadRnnoise,
  loadSpeex,
} from "@sapphi-red/web-noise-suppressor";

export type NoiseSuppressionMode = "off" | "rnnoise" | "speex" | "noisegate";

export interface NoiseSuppressorUrls {
  rnnoiseWorklet: string;
  rnnoiseWasm: string;
  rnnoiseWasmSimd: string;
  speexWorklet: string;
  speexWasm: string;
  noiseGateWorklet: string;
}

/**
 * Manages noise suppression AudioWorklet nodes.
 * Handles loading worklet modules + WASM binaries, creating/destroying nodes.
 */
export class NoiseSuppressor {
  private currentNode: AudioWorkletNode | null = null;
  private currentMode: NoiseSuppressionMode = "off";
  private activationId = 0;
  private urls: NoiseSuppressorUrls;

  // Cache loaded WASM binaries
  private rnnoiseWasm: ArrayBuffer | null = null;
  private speexWasm: ArrayBuffer | null = null;

  // Track which worklet modules have been registered
  private registeredModules = new WeakMap<AudioContext, Set<string>>();

  constructor(urls: NoiseSuppressorUrls) {
    this.urls = urls;
  }

  getMode(): NoiseSuppressionMode {
    return this.currentMode;
  }

  getNode(): AudioWorkletNode | null {
    return this.currentNode;
  }

  /**
   * Activate a noise suppression mode. Returns the AudioWorkletNode to insert into the graph.
   * Returns null if mode is 'off'.
   */
  async activate(
    mode: NoiseSuppressionMode,
    audioCtx: AudioContext,
  ): Promise<AudioWorkletNode | null> {
    // Deactivate current node first
    this.deactivate();
    const activationId = this.activationId;

    if (mode === "off") {
      this.currentMode = "off";
      return null;
    }

    try {
      const node = await this.createNode(mode, audioCtx);
      if (activationId !== this.activationId) {
        this.disposeNode(node);
        return null;
      }
      this.currentNode = node;
      this.currentMode = mode;
      logger.info(`[NoiseSuppressor] Activated mode: ${mode}`);
      return node;
    } catch (err) {
      if (activationId !== this.activationId) return null;
      logger.error(`[NoiseSuppressor] Failed to activate mode ${mode}:`, err);
      this.currentMode = "off";
      throw err;
    }
  }

  /**
   * Deactivate and disconnect the current suppressor node.
   */
  deactivate(): void {
    this.activationId++;
    if (this.currentNode) {
      this.disposeNode(this.currentNode);
      this.currentNode = null;
    }
    this.currentMode = "off";
  }

  private disposeNode(node: AudioWorkletNode): void {
    try {
      if ("destroy" in node && typeof node.destroy === "function") node.destroy();
    } catch { /* The worklet may already be destroyed. */ }
    try { node.disconnect(); } catch { /* Already disconnected. */ }
  }

  private async createNode(
    mode: NoiseSuppressionMode,
    audioCtx: AudioContext,
  ): Promise<AudioWorkletNode> {
    switch (mode) {
      case "rnnoise":
        return this.createRnnoiseNode(audioCtx);
      case "speex":
        return this.createSpeexNode(audioCtx);
      case "noisegate":
        return this.createNoiseGateNode(audioCtx);
      default:
        throw new Error(`Unknown noise suppression mode: ${mode}`);
    }
  }

  private async ensureWorkletModule(audioCtx: AudioContext, moduleUrl: string): Promise<void> {
    let modules = this.registeredModules.get(audioCtx);
    if (!modules) {
      modules = new Set();
      this.registeredModules.set(audioCtx, modules);
    }
    if (modules.has(moduleUrl)) return;
    logger.info(`[NoiseSuppressor] Loading worklet module: ${moduleUrl}`);
    await audioCtx.audioWorklet.addModule(moduleUrl);
    modules.add(moduleUrl);
    logger.info(`[NoiseSuppressor] Worklet module loaded successfully`);
  }

  private async createRnnoiseNode(audioCtx: AudioContext): Promise<RnnoiseWorkletNode> {
    await this.ensureWorkletModule(audioCtx, this.urls.rnnoiseWorklet);

    if (!this.rnnoiseWasm) {
      logger.info(`[NoiseSuppressor] Loading RNNoise WASM...`);
      this.rnnoiseWasm = await loadRnnoise({
        url: this.urls.rnnoiseWasm,
        simdUrl: this.urls.rnnoiseWasmSimd,
      });
      logger.info(`[NoiseSuppressor] RNNoise WASM loaded: ${this.rnnoiseWasm.byteLength} bytes`);
    }

    const node = new RnnoiseWorkletNode(audioCtx, {
      wasmBinary: this.rnnoiseWasm,
      maxChannels: 2,
    });

    node.port.onmessage = (e) => {
      logger.info(`[NoiseSuppressor] RNNoise worklet message:`, e.data);
    };

    return node;
  }

  private async createSpeexNode(audioCtx: AudioContext): Promise<SpeexWorkletNode> {
    await this.ensureWorkletModule(audioCtx, this.urls.speexWorklet);

    if (!this.speexWasm) {
      logger.info(`[NoiseSuppressor] Loading Speex WASM...`);
      this.speexWasm = await loadSpeex({
        url: this.urls.speexWasm,
      });
      logger.info(`[NoiseSuppressor] Speex WASM loaded: ${this.speexWasm.byteLength} bytes`);
    }

    const node = new SpeexWorkletNode(audioCtx, {
      wasmBinary: this.speexWasm,
      maxChannels: 2,
    });

    return node;
  }

  private async createNoiseGateNode(audioCtx: AudioContext): Promise<NoiseGateWorkletNode> {
    await this.ensureWorkletModule(audioCtx, this.urls.noiseGateWorklet);

    return new NoiseGateWorkletNode(audioCtx, {
      openThreshold: -40,
      closeThreshold: -50,
      holdMs: 100,
      maxChannels: 2,
    });
  }

  dispose(): void {
    this.deactivate();
    this.rnnoiseWasm = null;
    this.speexWasm = null;
    this.registeredModules = new WeakMap();
  }
}
