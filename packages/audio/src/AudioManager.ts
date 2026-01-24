import { Subject, BehaviorSubject, type Subscription } from "rxjs";
import { v4 } from "uuid";
import { ref, type Ref } from "vue";
import { logger, Disposable } from "@argon/core";

export type DeviceId = string;
export type WorkletPath = string;
export type WorkletId = string;

const STORAGE_KEYS = {
  INPUT_DEVICE: "inputDeviceId",
  OUTPUT_DEVICE: "outputDeviceId",
  INPUT_VOLUME: "inputVolume",
  OUTPUT_VOLUME: "outputVolume",
  INPUT_MUTED: "inputMuted",
  OUTPUT_MUTED: "outputMuted",
  NOISE_SUPPRESSION: "noiseSuppression",
  ECHO_CANCELLATION: "echoCancellation",
  AUTO_GAIN_CONTROL: "autoGainControl",
} as const;

export interface AudioConstraints {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export interface AudioLevels {
  input: number;  // 0-100
  output: number; // 0-100
}

export interface DeviceInfo {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

export interface IAudioManagement {
  // Device management
  getOutputDevice(): Ref<DeviceId>;
  getInputDevice(): Ref<DeviceId>;
  setInputDevice(deviceId: DeviceId): Promise<void>;
  setOutputDevice(deviceId: DeviceId): void;
  enumerateDevicesByKind(kind: "audioinput" | "videoinput" | "audiooutput"): Promise<MediaDeviceInfo[]>;
  
  // Volume control
  getInputVolume(): Ref<number>;
  getOutputVolume(): Ref<number>;
  setInputVolume(volume: number): void;
  setOutputVolume(volume: number): void;
  
  // Mute control
  isInputMuted(): Ref<boolean>;
  isOutputMuted(): Ref<boolean>;
  setInputMuted(muted: boolean): void;
  setOutputMuted(muted: boolean): void;
  toggleInputMute(): boolean;
  toggleOutputMute(): boolean;
  
  // Audio processing settings
  getAudioConstraints(): AudioConstraints;
  setAudioConstraints(constraints: Partial<AudioConstraints>): Promise<void>;
  
  // Streams
  getVirtualInputStream(): Promise<MediaStream>;
  createRawInputMediaStream(): Promise<MediaStream>;
  
  // Media elements
  createAudioElement(stream?: MediaStream): Promise<Disposable<HTMLAudioElement>>;
  createVideoElement(): Promise<Disposable<HTMLVideoElement>>;
  
  // VU Meters
  createVUMeterLight(stream: MediaStream, onLevel: (level: number) => void): Promise<Disposable<AudioWorkletNode>>;
  createVirtualVUMeter(onLevel: (level: number) => void): Promise<Disposable<AudioWorkletNode>>;
  
  // Events
  onInputDeviceChanged(on: (devId: DeviceId) => void): Subscription;
  onOutputDeviceChanged(on: (devId: DeviceId) => void): Subscription;
  onInputVolumeChanged(on: (volume: number) => void): Subscription;
  onOutputVolumeChanged(on: (volume: number) => void): Subscription;
  onInputMutedChanged(on: (muted: boolean) => void): Subscription;
  onOutputMutedChanged(on: (muted: boolean) => void): Subscription;
  onDevicesChanged(on: (devices: MediaDeviceInfo[]) => void): Subscription;
  onInputLevelChanged(on: (level: number) => void): Subscription;
  
  // Testing
  playTestSound(frequency?: number, duration?: number): Promise<void>;
  playTestChord(): Promise<void>;
  startInputMonitoring(): Promise<Disposable<void>>;
  
  // Utilities
  volumeToPercent(vol: number): number;
  volumeColor(volume: number): string;
  getCurrentAudioContext(): AudioContext;
  
  // Worklets
  addWorkletModule(workletPath: WorkletPath, name: WorkletId): Promise<void>;
  getOrCreateWorkletModule(name: WorkletId, options: AudioWorkletNodeOptions): Promise<Disposable<AudioWorkletNode>>;
  workletBranchByOrderConnect(worklets: AudioWorkletNode[]): void;
  
  // Lifecycle
  dispose(): void;
}

export interface AudioManagerConfig {
  /** Base path for worklet files. Default: '/audio' */
  workletBasePath?: string;
  /** Sample rate for AudioContext. Default: 48000 */
  sampleRate?: number;
  /** Enable input level monitoring by default. Default: false */
  enableInputLevelMonitoring?: boolean;
}

export class AudioManagement implements IAudioManagement {
  private audioCtx: AudioContext;
  private worklets = new Map<string, AudioWorkletNode>();
  private workletPaths = new Map<WorkletId, WorkletPath>();
  private mediaElements = new Set<HTMLMediaElement>();

  // Device state
  private inputDeviceId: Ref<DeviceId> = ref("default");
  private outputDeviceId: Ref<DeviceId> = ref("default");

  // Volume state (0-100)
  private inputVolume: Ref<number> = ref(100);
  private outputVolume: Ref<number> = ref(100);
  
  // Mute state
  private inputMuted: Ref<boolean> = ref(false);
  private outputMuted: Ref<boolean> = ref(false);
  
  // Audio processing constraints
  private audioConstraints: AudioConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  // RxJS Subjects for events
  private inputDevice$ = new Subject<DeviceId>();
  private outputDevice$ = new Subject<DeviceId>();
  private inputVolume$ = new BehaviorSubject<number>(100);
  private outputVolume$ = new BehaviorSubject<number>(100);
  private inputMuted$ = new BehaviorSubject<boolean>(false);
  private outputMuted$ = new BehaviorSubject<boolean>(false);
  private devices$ = new Subject<MediaDeviceInfo[]>();
  private inputLevel$ = new BehaviorSubject<number>(0);

  private config: Required<AudioManagerConfig>;

  // Virtual input stream architecture
  private virtualStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private currentMicStream: MediaStream | null = null;
  private currentMicSource: MediaStreamAudioSourceNode | null = null;
  private inputGainNode: GainNode | null = null;
  private virtualStreamInitialized = false;
  private virtualStreamInitPromise: Promise<MediaStream> | null = null;
  
  // Output gain control
  private masterGainNode: GainNode | null = null;
  
  // Input level monitoring
  private inputLevelMonitorDisposable: Disposable<AudioWorkletNode> | null = null;
  
  // Device change listener
  private deviceChangeHandler: (() => void) | null = null;

  constructor(config: AudioManagerConfig = {}) {
    this.config = {
      workletBasePath: config.workletBasePath ?? '/audio',
      sampleRate: config.sampleRate ?? 48000,
      enableInputLevelMonitoring: config.enableInputLevelMonitoring ?? false,
    };
    this.audioCtx = new AudioContext({ sampleRate: this.config.sampleRate });
    this.loadSavedSettings();
    this.setupDeviceChangeListener();
    
    // Create master gain node for output volume control
    this.masterGainNode = this.audioCtx.createGain();
    this.masterGainNode.connect(this.audioCtx.destination);
    this.applyOutputVolume();
  }

  /** Get the base path for worklet files */
  get workletBasePath(): string {
    return this.config.workletBasePath;
  }

  // ==================== LIFECYCLE ====================

  dispose(): void {
    this.inputDevice$.complete();
    this.outputDevice$.complete();
    this.inputVolume$.complete();
    this.outputVolume$.complete();
    this.inputMuted$.complete();
    this.outputMuted$.complete();
    this.devices$.complete();
    this.inputLevel$.complete();
    
    // Remove device change listener
    if (this.deviceChangeHandler) {
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeHandler);
    }
    
    // Cleanup input level monitor
    this.inputLevelMonitorDisposable?.dispose();
    
    // Cleanup virtual stream
    this.cleanupCurrentMicSource();
    this.virtualStreamDestination?.disconnect();
    this.inputGainNode?.disconnect();
    this.masterGainNode?.disconnect();
    this.virtualStreamDestination = null;
    this.inputGainNode = null;
    this.masterGainNode = null;
    this.virtualStreamInitialized = false;
    this.virtualStreamInitPromise = null;
    
    for (const worklet of this.worklets.values()) {
      worklet.disconnect();
    }
    this.worklets.clear();
    if (this.audioCtx.state !== "closed") {
      this.audioCtx.close();
    }
  }

  // ==================== SETTINGS PERSISTENCE ====================

  private loadSavedSettings() {
    // Devices
    const input = localStorage.getItem(STORAGE_KEYS.INPUT_DEVICE);
    const output = localStorage.getItem(STORAGE_KEYS.OUTPUT_DEVICE);
    if (input) this.inputDeviceId.value = input;
    if (output) this.outputDeviceId.value = output;
    
    // Volumes
    const inputVol = localStorage.getItem(STORAGE_KEYS.INPUT_VOLUME);
    const outputVol = localStorage.getItem(STORAGE_KEYS.OUTPUT_VOLUME);
    if (inputVol) {
      this.inputVolume.value = parseFloat(inputVol);
      this.inputVolume$.next(this.inputVolume.value);
    }
    if (outputVol) {
      this.outputVolume.value = parseFloat(outputVol);
      this.outputVolume$.next(this.outputVolume.value);
    }
    
    // Mute states
    const inputMuted = localStorage.getItem(STORAGE_KEYS.INPUT_MUTED);
    const outputMuted = localStorage.getItem(STORAGE_KEYS.OUTPUT_MUTED);
    if (inputMuted) {
      this.inputMuted.value = inputMuted === 'true';
      this.inputMuted$.next(this.inputMuted.value);
    }
    if (outputMuted) {
      this.outputMuted.value = outputMuted === 'true';
      this.outputMuted$.next(this.outputMuted.value);
    }
    
    // Audio constraints
    const noiseSuppression = localStorage.getItem(STORAGE_KEYS.NOISE_SUPPRESSION);
    const echoCancellation = localStorage.getItem(STORAGE_KEYS.ECHO_CANCELLATION);
    const autoGainControl = localStorage.getItem(STORAGE_KEYS.AUTO_GAIN_CONTROL);
    if (noiseSuppression !== null) this.audioConstraints.noiseSuppression = noiseSuppression === 'true';
    if (echoCancellation !== null) this.audioConstraints.echoCancellation = echoCancellation === 'true';
    if (autoGainControl !== null) this.audioConstraints.autoGainControl = autoGainControl === 'true';

    logger.info("[AudioManagement] Loaded saved settings:", {
      inputDevice: this.inputDeviceId.value,
      outputDevice: this.outputDeviceId.value,
      inputVolume: this.inputVolume.value,
      outputVolume: this.outputVolume.value,
      inputMuted: this.inputMuted.value,
      outputMuted: this.outputMuted.value,
      constraints: this.audioConstraints,
    });
  }

  // ==================== DEVICE MANAGEMENT ====================

  private setupDeviceChangeListener() {
    this.deviceChangeHandler = async () => {
      logger.info("[AudioManagement] Device change detected");
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.devices$.next(devices);
      
      // Check if current devices still exist
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
      
      // If current input device was removed, switch to default
      if (this.inputDeviceId.value !== 'default') {
        const inputExists = audioInputs.some(d => d.deviceId === this.inputDeviceId.value);
        if (!inputExists) {
          logger.warn("[AudioManagement] Input device removed, switching to default");
          await this.setInputDevice('default');
        }
      }
      
      // If current output device was removed, switch to default
      if (this.outputDeviceId.value !== 'default') {
        const outputExists = audioOutputs.some(d => d.deviceId === this.outputDeviceId.value);
        if (!outputExists) {
          logger.warn("[AudioManagement] Output device removed, switching to default");
          this.setOutputDevice('default');
        }
      }
    };
    
    navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeHandler);
  }

  async enumerateDevicesByKind(
    kind: "audioinput" | "videoinput" | "audiooutput",
  ): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(
      (d) => d.kind === kind && d.deviceId && d.deviceId !== "communications",
    );
  }

  getInputDevice(): Ref<DeviceId> {
    return this.inputDeviceId;
  }

  getOutputDevice(): Ref<DeviceId> {
    return this.outputDeviceId;
  }

  async setInputDevice(deviceId: DeviceId): Promise<void> {
    logger.info("[AudioManagement] setInputDevice:", deviceId);
    
    const previousDeviceId = this.inputDeviceId.value;
    this.inputDeviceId.value = deviceId;
    localStorage.setItem(STORAGE_KEYS.INPUT_DEVICE, deviceId);
    
    // If virtual stream is initialized, switch the microphone
    if (this.virtualStreamInitialized) {
      try {
        await this.connectMicrophoneToVirtualStream(deviceId);
        logger.info('[AudioManagement] Microphone switched successfully to:', deviceId);
      } catch (err) {
        logger.error('[AudioManagement] Failed to switch microphone, reverting:', err);
        this.inputDeviceId.value = previousDeviceId;
        localStorage.setItem(STORAGE_KEYS.INPUT_DEVICE, previousDeviceId);
        throw err;
      }
    }
    
    // Notify subscribers AFTER successful switch
    this.inputDevice$.next(deviceId);
  }

  setOutputDevice(deviceId: DeviceId) {
    logger.info("[AudioManagement] setOutputDevice:", deviceId);
    this.outputDeviceId.value = deviceId;
    this.outputDevice$.next(deviceId);
    localStorage.setItem(STORAGE_KEYS.OUTPUT_DEVICE, deviceId);
    
    // Apply to all existing media elements
    for (const el of this.mediaElements) {
      this.applySinkIdToElement(el);
    }
  }

  // ==================== VOLUME CONTROL ====================

  getInputVolume(): Ref<number> {
    return this.inputVolume;
  }

  getOutputVolume(): Ref<number> {
    return this.outputVolume;
  }

  setInputVolume(volume: number): void {
    const clampedVolume = Math.max(0, Math.min(100, volume));
    logger.info("[AudioManagement] setInputVolume:", clampedVolume);
    
    this.inputVolume.value = clampedVolume;
    this.inputVolume$.next(clampedVolume);
    localStorage.setItem(STORAGE_KEYS.INPUT_VOLUME, clampedVolume.toString());
    
    this.applyInputVolume();
  }

  setOutputVolume(volume: number): void {
    const clampedVolume = Math.max(0, Math.min(100, volume));
    logger.info("[AudioManagement] setOutputVolume:", clampedVolume);
    
    this.outputVolume.value = clampedVolume;
    this.outputVolume$.next(clampedVolume);
    localStorage.setItem(STORAGE_KEYS.OUTPUT_VOLUME, clampedVolume.toString());
    
    this.applyOutputVolume();
  }

  private applyInputVolume(): void {
    if (this.inputGainNode) {
      // Convert 0-100 to gain (0-1), with curve for natural feel
      const gain = this.inputMuted.value ? 0 : Math.pow(this.inputVolume.value / 100, 2);
      this.inputGainNode.gain.setTargetAtTime(gain, this.audioCtx.currentTime, 0.015);
    }
  }

  private applyOutputVolume(): void {
    if (this.masterGainNode) {
      // Convert 0-100 to gain (0-1), with curve for natural feel
      const gain = this.outputMuted.value ? 0 : Math.pow(this.outputVolume.value / 100, 2);
      this.masterGainNode.gain.setTargetAtTime(gain, this.audioCtx.currentTime, 0.015);
    }
    
    // Also apply to all media elements (they bypass AudioContext)
    for (const el of this.mediaElements) {
      if (el instanceof HTMLAudioElement || el instanceof HTMLVideoElement) {
        el.volume = this.outputMuted.value ? 0 : this.outputVolume.value / 100;
      }
    }
  }

  // ==================== MUTE CONTROL ====================

  isInputMuted(): Ref<boolean> {
    return this.inputMuted;
  }

  isOutputMuted(): Ref<boolean> {
    return this.outputMuted;
  }

  setInputMuted(muted: boolean): void {
    logger.info("[AudioManagement] setInputMuted:", muted);
    this.inputMuted.value = muted;
    this.inputMuted$.next(muted);
    localStorage.setItem(STORAGE_KEYS.INPUT_MUTED, muted.toString());
    this.applyInputVolume();
  }

  setOutputMuted(muted: boolean): void {
    logger.info("[AudioManagement] setOutputMuted:", muted);
    this.outputMuted.value = muted;
    this.outputMuted$.next(muted);
    localStorage.setItem(STORAGE_KEYS.OUTPUT_MUTED, muted.toString());
    this.applyOutputVolume();
  }

  toggleInputMute(): boolean {
    const newState = !this.inputMuted.value;
    this.setInputMuted(newState);
    return newState;
  }

  toggleOutputMute(): boolean {
    const newState = !this.outputMuted.value;
    this.setOutputMuted(newState);
    return newState;
  }

  // ==================== AUDIO CONSTRAINTS ====================

  getAudioConstraints(): AudioConstraints {
    return { ...this.audioConstraints };
  }

  async setAudioConstraints(constraints: Partial<AudioConstraints>): Promise<void> {
    logger.info("[AudioManagement] setAudioConstraints:", constraints);
    
    const changed = 
      (constraints.echoCancellation !== undefined && constraints.echoCancellation !== this.audioConstraints.echoCancellation) ||
      (constraints.noiseSuppression !== undefined && constraints.noiseSuppression !== this.audioConstraints.noiseSuppression) ||
      (constraints.autoGainControl !== undefined && constraints.autoGainControl !== this.audioConstraints.autoGainControl);
    
    // Update constraints
    if (constraints.echoCancellation !== undefined) {
      this.audioConstraints.echoCancellation = constraints.echoCancellation;
      localStorage.setItem(STORAGE_KEYS.ECHO_CANCELLATION, constraints.echoCancellation.toString());
    }
    if (constraints.noiseSuppression !== undefined) {
      this.audioConstraints.noiseSuppression = constraints.noiseSuppression;
      localStorage.setItem(STORAGE_KEYS.NOISE_SUPPRESSION, constraints.noiseSuppression.toString());
    }
    if (constraints.autoGainControl !== undefined) {
      this.audioConstraints.autoGainControl = constraints.autoGainControl;
      localStorage.setItem(STORAGE_KEYS.AUTO_GAIN_CONTROL, constraints.autoGainControl.toString());
    }
    
    // Reconnect microphone if virtual stream is active and constraints changed
    if (changed && this.virtualStreamInitialized) {
      await this.connectMicrophoneToVirtualStream(this.inputDeviceId.value);
    }
  }

  // ==================== VIRTUAL INPUT STREAM ====================

  private async initVirtualStream(): Promise<MediaStream> {
    if (this.virtualStreamInitPromise) {
      return this.virtualStreamInitPromise;
    }

    this.virtualStreamInitPromise = this._initVirtualStreamInternal();
    return this.virtualStreamInitPromise;
  }

  private async _initVirtualStreamInternal(): Promise<MediaStream> {
    const ctx = this.getCurrentAudioContext();
    
    // Create the permanent destination node - this stream never changes
    this.virtualStreamDestination = ctx.createMediaStreamDestination();
    
    // Create a gain node for input volume control
    this.inputGainNode = ctx.createGain();
    this.inputGainNode.connect(this.virtualStreamDestination);
    this.applyInputVolume();
    
    // Connect the initial microphone
    await this.connectMicrophoneToVirtualStream(this.inputDeviceId.value);
    
    this.virtualStreamInitialized = true;
    logger.info('[AudioManagement] Virtual input stream initialized');
    
    // Start input level monitoring if enabled
    if (this.config.enableInputLevelMonitoring) {
      this.startInputLevelMonitoring();
    }
    
    return this.virtualStreamDestination.stream;
  }

  private async connectMicrophoneToVirtualStream(deviceId: DeviceId): Promise<void> {
    const ctx = this.getCurrentAudioContext();
    
    // Cleanup previous source
    this.cleanupCurrentMicSource();
    
    try {
      // Get new microphone stream with current constraints
      this.currentMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 2,
          echoCancellation: this.audioConstraints.echoCancellation,
          noiseSuppression: this.audioConstraints.noiseSuppression,
          autoGainControl: this.audioConstraints.autoGainControl,
          deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
          sampleRate: this.config.sampleRate,
        },
      });
      
      // Create source and connect to gain node
      this.currentMicSource = ctx.createMediaStreamSource(this.currentMicStream);
      
      if (this.inputGainNode) {
        this.currentMicSource.connect(this.inputGainNode);
      }
      
      logger.info('[AudioManagement] Microphone connected to virtual stream:', deviceId);
    } catch (err) {
      logger.error('[AudioManagement] Failed to connect microphone:', err);
      throw err;
    }
  }

  private cleanupCurrentMicSource(): void {
    if (this.currentMicSource) {
      this.currentMicSource.disconnect();
      this.currentMicSource = null;
    }
    if (this.currentMicStream) {
      this.currentMicStream.getTracks().forEach(track => track.stop());
      this.currentMicStream = null;
    }
  }

  async getVirtualInputStream(): Promise<MediaStream> {
    if (!this.virtualStreamInitialized) {
      return this.initVirtualStream();
    }
    return this.virtualStreamDestination!.stream;
  }

  async createRawInputMediaStream(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 2,
          echoCancellation: this.audioConstraints.echoCancellation,
          noiseSuppression: this.audioConstraints.noiseSuppression,
          autoGainControl: this.audioConstraints.autoGainControl,
          deviceId: this.getInputDevice().value,
          sampleRate: this.config.sampleRate,
        },
      });
    } catch (err) {
      logger.error("[AudioManagement] Failed to get user media:", err);
      throw err;
    }
  }

  // ==================== INPUT LEVEL MONITORING ====================

  private async startInputLevelMonitoring(): Promise<void> {
    if (this.inputLevelMonitorDisposable) return;
    
    try {
      const virtualStream = await this.getVirtualInputStream();
      this.inputLevelMonitorDisposable = await this.createVUMeterLight(virtualStream, (level) => {
        this.inputLevel$.next(level);
      });
    } catch (err) {
      logger.error('[AudioManagement] Failed to start input level monitoring:', err);
    }
  }

  onInputLevelChanged(on: (level: number) => void): Subscription {
    // Start monitoring if not already running
    if (!this.inputLevelMonitorDisposable && this.virtualStreamInitialized) {
      this.startInputLevelMonitoring();
    }
    return this.inputLevel$.subscribe(on);
  }

  // ==================== MEDIA ELEMENTS ====================

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
    
    // Apply current volume
    el.volume = this.outputMuted.value ? 0 : this.outputVolume.value / 100;

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
    
    // Apply current volume
    el.volume = this.outputMuted.value ? 0 : this.outputVolume.value / 100;

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

  // ==================== VU METERS ====================

  async createVUMeterLight(
    stream: MediaStream,
    onLevel: (level: number) => void
  ): Promise<Disposable<AudioWorkletNode>> {
    const ctx = this.getCurrentAudioContext();
    
    // Add worklet module if not already added
    if (!this.workletPaths.has('vu-meter-light')) {
      const workletPath = `${this.config.workletBasePath}/vu-meter-light.js`;
      await ctx.audioWorklet.addModule(workletPath);
      this.workletPaths.set('vu-meter-light', workletPath);
    }
    
    const sourceNode = ctx.createMediaStreamSource(stream);
    const vuMeter = new AudioWorkletNode(ctx, 'vu-meter-light');
    
    vuMeter.port.onmessage = (event) => {
      const level = Math.min(100, event.data * 150);
      onLevel(Math.round(level));
    };
    
    sourceNode.connect(vuMeter);
    
    const dispose = async (node: AudioWorkletNode) => {
      logger.debug('[AudioManagement] Disposing VU meter light');
      node.port.close();
      node.disconnect();
      sourceNode.disconnect();
      // Don't stop tracks if using virtual stream - it's shared!
      const isVirtualStream = this.virtualStreamDestination?.stream === stream;
      if (!isVirtualStream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
    
    return new Disposable(vuMeter, dispose);
  }

  async createVirtualVUMeter(
    onLevel: (level: number) => void
  ): Promise<Disposable<AudioWorkletNode>> {
    const virtualStream = await this.getVirtualInputStream();
    return this.createVUMeterLight(virtualStream, onLevel);
  }

  // ==================== EVENTS ====================

  onInputDeviceChanged(on: (devId: DeviceId) => void): Subscription {
    return this.inputDevice$.subscribe(on);
  }

  onOutputDeviceChanged(on: (devId: DeviceId) => void): Subscription {
    return this.outputDevice$.subscribe(on);
  }

  onInputVolumeChanged(on: (volume: number) => void): Subscription {
    return this.inputVolume$.subscribe(on);
  }

  onOutputVolumeChanged(on: (volume: number) => void): Subscription {
    return this.outputVolume$.subscribe(on);
  }

  onInputMutedChanged(on: (muted: boolean) => void): Subscription {
    return this.inputMuted$.subscribe(on);
  }

  onOutputMutedChanged(on: (muted: boolean) => void): Subscription {
    return this.outputMuted$.subscribe(on);
  }

  onDevicesChanged(on: (devices: MediaDeviceInfo[]) => void): Subscription {
    return this.devices$.subscribe(on);
  }

  // ==================== TESTING ====================

  /**
   * Play a test sound through the current output device
   */
  async playTestSound(frequency: number = 440, duration: number = 0.5): Promise<void> {
    const ctx = this.getCurrentAudioContext();
    
    // Create oscillator
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    
    // Envelope for smooth sound
    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
    
    oscillator.connect(gainNode);
    
    // Connect to master gain if available, otherwise directly to destination
    if (this.masterGainNode) {
      gainNode.connect(this.masterGainNode);
    } else {
      gainNode.connect(ctx.destination);
    }
    
    oscillator.start(now);
    oscillator.stop(now + duration);
    
    // Cleanup
    return new Promise(resolve => {
      setTimeout(() => {
        oscillator.disconnect();
        gainNode.disconnect();
        resolve();
      }, duration * 1000 + 100);
    });
  }

  /**
   * Play a pleasant test chord (C-E-G)
   */
  async playTestChord(): Promise<void> {
    const ctx = this.getCurrentAudioContext();
    
    const notes = [
      { freq: 523.25, start: 0, duration: 0.25 },     // C5
      { freq: 659.25, start: 0.15, duration: 0.25 },  // E5
      { freq: 783.99, start: 0.30, duration: 0.35 }   // G5
    ];
    
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.15;
    
    if (this.masterGainNode) {
      masterGain.connect(this.masterGainNode);
    } else {
      masterGain.connect(ctx.destination);
    }
    
    notes.forEach(({ freq, start, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.value = 2000;
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      
      const startTime = ctx.currentTime + start;
      const endTime = startTime + duration;
      
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(1, startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, endTime);
      
      osc.start(startTime);
      osc.stop(endTime);
    });
    
    return new Promise(resolve => setTimeout(resolve, 800));
  }

  /**
   * Start monitoring input - lets you hear yourself through the output
   */
  async startInputMonitoring(): Promise<Disposable<void>> {
    const virtualStream = await this.getVirtualInputStream();
    const audioEl = await this.createAudioElement(virtualStream);
    
    logger.info('[AudioManagement] Input monitoring started');
    
    const dispose = async () => {
      await audioEl.asyncDispose();
      logger.info('[AudioManagement] Input monitoring stopped');
    };
    
    return new Disposable(undefined as void, dispose);
  }

  // ==================== UTILITIES ====================

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
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  // ==================== WORKLETS ====================

  async addWorkletModule(
    workletPath: WorkletPath,
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
