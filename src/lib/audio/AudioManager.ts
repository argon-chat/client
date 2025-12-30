import { Subject, type Subscription } from "rxjs";
import { v4 } from "uuid";
import { ref, type Ref } from "vue";
import { logger } from "../logger";
import { Disposable } from "../disposables";
import { WebRTCProcessor } from "./WebRTCProcessor";

export type DeviceId = string;
export type WorkledPath = string;
export type WorkletId = string;

const STORAGE_KEYS = {
  INPUT_DEVICE: "inputDeviceId",
  OUTPUT_DEVICE: "outputDeviceId",
} as const;

export interface IAudioManagement {
  createAudioElement(
    stream?: MediaStream,
  ): Promise<Disposable<HTMLAudioElement>>;
  createVideoElement(): Promise<Disposable<HTMLVideoElement>>;

  getOutputDevice(): Ref<DeviceId, DeviceId>;
  getInputDevice(): Ref<DeviceId, DeviceId>;

  onInputDeviceChanged(on: (devId: DeviceId) => void): Subscription;
  onOutputDeviceChanged(on: (devId: DeviceId) => void): Subscription;

  volumeToPercent(vol: number): number;
  volumeColor(vol: number): string;

  getCurrentAudioContext(): AudioContext;

  addWorkletModule(workletPath: WorkledPath, name: WorkletId): Promise<void>;

  getOrCreateWorkletModule(
    name: WorkletId,
    options: AudioWorkletNodeOptions,
  ): Promise<Disposable<AudioWorkletNode>>;

  workletBranchByOrderConnect(worklets: AudioWorkletNode[]): void;

  createRawInputMediaStream(): Promise<MediaStream>;

  createRtcProcessor(): WebRTCProcessor;

  enumerateDevicesByKind(
    kind: "audioinput" | "videoinput" | "audiooutput",
  ): Promise<MediaDeviceInfo[]>;

  dispose(): void;
}

export class AudioManagement implements IAudioManagement {
  private audioCtx: AudioContext = new AudioContext();
  private worklets = new Map<string, AudioWorkletNode>();
  private workletPaths = new Map<WorkletId, WorkledPath>();
  private mediaElements = new Set<HTMLMediaElement>();

  private inputDeviceId: Ref<DeviceId> = ref("default");
  private outputDeviceId: Ref<DeviceId> = ref("default");

  private inputDevice$ = new Subject<DeviceId>();
  private outputDevice$ = new Subject<DeviceId>();

  constructor() {
    this.loadSavedDevices();
  }

  dispose(): void {
    this.inputDevice$.complete();
    this.outputDevice$.complete();
    for (const worklet of this.worklets.values()) {
      worklet.disconnect();
    }
    this.worklets.clear();
    if (this.audioCtx.state !== "closed") {
      this.audioCtx.close();
    }
  }

  private loadSavedDevices() {
    const input = localStorage.getItem(STORAGE_KEYS.INPUT_DEVICE);
    const output = localStorage.getItem(STORAGE_KEYS.OUTPUT_DEVICE);

    logger.info("Loading saved devices:", { input, output });
    if (input) {
      this.inputDeviceId.value = input;
    }
    if (output) {
      this.outputDeviceId.value = output;
    }
  }

  async enumerateDevicesByKind(
    kind: "audioinput" | "videoinput" | "audiooutput",
  ): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(
      (d) => d.kind === kind && d.deviceId && d.deviceId !== "communications",
    );
  }

  private setInputDevice(deviceId: DeviceId) {
    logger.info("setInputDevice", deviceId);
    this.inputDeviceId.value = deviceId;
    this.inputDevice$.next(deviceId);
    localStorage.setItem(STORAGE_KEYS.INPUT_DEVICE, deviceId);
  }

  getOutputDevice(): Ref<DeviceId> {
    return this.outputDeviceId;
  }

  getInputDevice(): Ref<DeviceId> {
    return this.inputDeviceId;
  }

  onInputDeviceChanged(on: (devId: DeviceId) => void): Subscription {
    return this.inputDevice$.subscribe(on);
  }

  onOutputDeviceChanged(on: (devId: DeviceId) => void): Subscription {
    return this.outputDevice$.subscribe(on);
  }

  async createRawInputMediaStream(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 2,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          deviceId: this.getInputDevice().value,
        },
      });
    } catch (err) {
      logger.error("[AudioManagement] Failed to get user media:", err);
      throw err;
    }
  }

  private setOutputDevice(deviceId: DeviceId) {
    logger.info("setOutputDevice", deviceId);
    this.outputDeviceId.value = deviceId;
    this.outputDevice$.next(deviceId);
    localStorage.setItem(STORAGE_KEYS.OUTPUT_DEVICE, deviceId);
    for (const el of this.mediaElements) {
      this.applySinkIdToElement(el);
    }
  }

  private async applySinkIdToElement(el: HTMLMediaElement) {
    const deviceId = this.outputDeviceId.value;
    if (deviceId && typeof el.setSinkId === "function") {
      try {
        await el.setSinkId(deviceId);
        logger.debug("[AudioManagement] Applied sinkId:", deviceId);
      } catch (err) {
        logger.warn("[AudioManagement] Failed to apply sinkId:", err);
      }
    }
  }

  async createAudioElement(
    stream?: MediaStream,
  ): Promise<Disposable<HTMLAudioElement>> {
    const el = document.createElement("audio");
    el.autoplay = true;
    el.dataset.weakSlaveTrack = v4();
    if (stream) el.srcObject = stream;

    this.mediaElements.add(el);
    await this.applySinkIdToElement(el);

    document.body.appendChild(el);
    const dispose = async (el: HTMLAudioElement) => {
      el.pause();
      el.src = "";
      el.srcObject = null;
      this.mediaElements.delete(el);
      el.remove();
    };

    return new Disposable(el, dispose);
  }

  async createVideoElement(): Promise<Disposable<HTMLVideoElement>> {
    const el = document.createElement("video");
    el.autoplay = true;
    el.playsInline = true;
    el.dataset.weakSlaveTrack = v4();

    this.mediaElements.add(el);
    await this.applySinkIdToElement(el);

    const dispose = async (el: HTMLVideoElement) => {
      el.pause();
      el.src = "";
      el.srcObject = null;
      this.mediaElements.delete(el);
      el.remove();
    };

    return new Disposable(el, dispose);
  }

  createRtcProcessor(): WebRTCProcessor {
    return new WebRTCProcessor(this);
  }

  volumeToPercent(vol: number): number {
    if (vol <= 0) return 0;

    const exponent = 0.3;
    return vol ** exponent * 100;
  }
  volumeColor(volume: number): string {
    if (volume < 20) return "#10b981";
    if (volume < 60) return "#facc15";
    return "#ef4444";
  }

  getCurrentAudioContext(): AudioContext {
    this.audioCtx.resume();
    return this.audioCtx;
  }

  async addWorkletModule(
    workletPath: WorkledPath,
    name: WorkletId,
  ): Promise<void> {
    this.workletPaths.set(name, workletPath);
    const path = this.workletPaths.get(name);
    if (path) {
      await this.audioCtx.audioWorklet.addModule(path);
    }
  }

  async getOrCreateWorkletModule(
    name: WorkletId,
    options: AudioWorkletNodeOptions,
  ): Promise<Disposable<AudioWorkletNode>> {
    const ctx = this.audioCtx;

    if (!this.workletPaths.has(name)) {
      throw new Error(`[AudioManagement] Worklet path not found: ${name}`);
    }

    if (!ctx.audioWorklet) {
      throw new Error(
        "[AudioManagement] AudioContext does not support AudioWorklet",
      );
    }

    const node = new AudioWorkletNode(ctx, name, options);
    const uniqueId = `${name}-${v4()}`;
    this.worklets.set(uniqueId, node);

    const disposable = new Disposable<AudioWorkletNode>(node, async (node) => {
      node.disconnect();
      this.worklets.delete(uniqueId);
    });
    return disposable;
  }

  workletBranchByOrderConnect(worklets: AudioWorkletNode[]): void {
    for (let i = 0; i < worklets.length - 1; i++) {
      worklets[i].connect(worklets[i + 1]);
    }
  }
}

const audio = new AudioManagement();

export { audio };
