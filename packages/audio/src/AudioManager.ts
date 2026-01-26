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

/**
 * Options and result for remote participant audio graph
 */
export interface RemoteAudioGraphOptions {
  /** The MediaStreamTrack from remote participant */
  track: MediaStreamTrack;
  /** Label for this audio source (e.g., participant name) */
  label?: string;
  /** Initial volume (0-200), default 100 */
  initialVolume?: number;
  /** Whether headphones are muted (applies 0 volume) */
  isMutedAll?: boolean;
  /** Callback when speaking state changes */
  onSpeakingChange?: (isSpeaking: boolean) => void;
  /** Speaking detection threshold (RMS), default 0.001 */
  speakingThreshold?: number;
}

export interface RemoteAudioGraph {
  /** Unique ID for this audio graph */
  graphId: string;
  /** The gain node for volume control */
  gainNode: GainNode;
  /** Set volume (0-200) */
  setVolume: (volume: number) => void;
  /** Get current volume */
  getVolume: () => number;
  /** Dispose the audio graph */
  dispose: () => void;
}

/** Info about a tracked remote audio graph */
export interface RemoteAudioGraphInfo {
  label: string;
  volume: number;
  speaking: boolean;
}

export interface IAudioManagement {
  // Device management
  getOutputDevice(): Ref<DeviceId>;
  getInputDevice(): Ref<DeviceId>;
  setInputDevice(deviceId: DeviceId): Promise<void>;
  setOutputDevice(deviceId: DeviceId): Promise<void>;
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
  
  // Remote participant audio
  createRemoteAudioGraph(options: RemoteAudioGraphOptions): RemoteAudioGraph;
  
  // VU Meters
  createVUMeterLight(stream: MediaStream, onLevel: (level: number) => void): Promise<Disposable<AudioWorkletNode>>;
  createVirtualVUMeter(onLevel: (level: number) => void): Promise<Disposable<AudioWorkletNode>>;
  createVUMeterStereo(stream: MediaStream, onLevel: (left: number, right: number) => void): Promise<Disposable<AudioWorkletNode>>;
  createVirtualVUMeterStereo(onLevel: (left: number, right: number) => void): Promise<Disposable<AudioWorkletNode>>;
  
  // Events
  onInputDeviceChanged(on: (devId: DeviceId) => void): Subscription;
  onOutputDeviceChanged(on: (devId: DeviceId) => void): Subscription;
  onInputVolumeChanged(on: (volume: number) => void): Subscription;
  onOutputVolumeChanged(on: (volume: number) => void): Subscription;
  onInputMutedChanged(on: (muted: boolean) => void): Subscription;
  onOutputMutedChanged(on: (muted: boolean) => void): Subscription;
  onDevicesChanged(on: (devices: MediaDeviceInfo[]) => void): Subscription;
  onInputLevelChanged(on: (level: number) => void): Subscription;
  onOutputLevelChanged(on: (level: number) => void): Subscription;
  
  // Testing
  playTestSound(frequency?: number, duration?: number): Promise<void>;
  playTestChord(): Promise<void>;
  startInputMonitoring(): Promise<Disposable<void>>;
  
  // Utilities
  volumeToPercent(vol: number): number;
  volumeColor(volume: number): string;
  getCurrentAudioContext(): AudioContext;
  
  // Output destination (for routing audio through master gain)
  getOutputDestination(): AudioNode;
  
  // Level reporting
  reportOutputLevel(level: number): void;
  
  // State
  isVirtualStreamInitialized(): boolean;
  isVirtualOutputInitialized(): boolean;
  
  // Worklets
  addWorkletModule(workletPath: WorkletPath, name: WorkletId): Promise<void>;
  getOrCreateWorkletModule(name: WorkletId, options: AudioWorkletNodeOptions): Promise<Disposable<AudioWorkletNode>>;
  workletBranchByOrderConnect(worklets: AudioWorkletNode[]): void;
  getActiveWorklets(): Map<string, AudioWorkletNode>;
  
  // Audio graph inspection
  getRemoteAudioGraphs(): Map<string, RemoteAudioGraphInfo>;
  getMediaElements(): Set<HTMLMediaElement>;
  
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
  /** Automatically initialize virtual input stream on startup. Default: true */
  autoInitialize?: boolean;
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
  private outputLevel$ = new BehaviorSubject<number>(0);

  private config: Required<AudioManagerConfig>;

  // Virtual input stream architecture
  private virtualStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private currentMicStream: MediaStream | null = null;
  private currentMicSource: MediaStreamAudioSourceNode | null = null;
  private inputGainNode: GainNode | null = null;
  private virtualStreamInitialized = false;
  private virtualStreamInitPromise: Promise<MediaStream> | null = null;
  
  // Virtual output stream architecture
  private outputAnalyserNode: AnalyserNode | null = null;
  private masterGainNode: GainNode | null = null;
  private virtualOutputInitialized = false;
  private outputLevelAnimationFrame: number | null = null;
  
  // Input level monitoring
  private inputLevelMonitorDisposable: Disposable<AudioWorkletNode> | null = null;
  
  // Device change listener
  private deviceChangeHandler: (() => void) | null = null;
  
  // Audio element monitoring
  private audioElementObserver: MutationObserver | null = null;
  private trackedAudioElements = new WeakSet<HTMLAudioElement>();
  
  // Remote audio graphs tracking
  private remoteAudioGraphs = new Map<string, { label: string; volume: number; speaking: boolean }>();

  constructor(config: AudioManagerConfig = {}) {
    this.config = {
      workletBasePath: config.workletBasePath ?? '/audio',
      sampleRate: config.sampleRate ?? 48000,
      enableInputLevelMonitoring: config.enableInputLevelMonitoring ?? false,
      autoInitialize: config.autoInitialize ?? true,
    };
    this.audioCtx = new AudioContext({ sampleRate: this.config.sampleRate });
    this.validateAndAdaptConfig();
    this.loadSavedSettings();
    this.setupDeviceChangeListener();
    this.setupAudioElementMonitor();
    
    // Initialize virtual output stream (synchronous, no permissions needed)
    this.initVirtualOutputStream();
    
    // Auto-initialize virtual input stream if enabled
    if (this.config.autoInitialize) {
      this.initVirtualStream().catch(err => {
        logger.warn('[AudioManagement] Auto-init of virtual stream failed (will retry on first use):', err);
      });
    }
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
    this.outputLevel$.complete();
    
    // Remove device change listener
    if (this.deviceChangeHandler) {
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeHandler);
    }
    
    // Cleanup audio element observer
    if (this.audioElementObserver) {
      this.audioElementObserver.disconnect();
      this.audioElementObserver = null;
    }
    
    // Cleanup input level monitor
    this.inputLevelMonitorDisposable?.dispose();
    
    // Cleanup output level monitor
    if (this.outputLevelAnimationFrame) {
      cancelAnimationFrame(this.outputLevelAnimationFrame);
      this.outputLevelAnimationFrame = null;
    }
    
    // Cleanup virtual input stream
    this.cleanupCurrentMicSource();
    this.virtualStreamDestination?.disconnect();
    this.inputGainNode?.disconnect();
    this.virtualStreamDestination = null;
    this.inputGainNode = null;
    this.virtualStreamInitialized = false;
    this.virtualStreamInitPromise = null;
    
    // Cleanup virtual output stream
    this.masterGainNode?.disconnect();
    this.outputAnalyserNode?.disconnect();
    this.masterGainNode = null;
    this.outputAnalyserNode = null;
    this.virtualOutputInitialized = false;
    
    for (const worklet of this.worklets.values()) {
      worklet.disconnect();
    }
    this.worklets.clear();
    if (this.audioCtx.state !== "closed") {
      this.audioCtx.close();
    }
  }

  // ==================== CONFIG VALIDATION ====================

  private validateAndAdaptConfig(): void {
    const actualSampleRate = this.audioCtx.sampleRate;
    
    if (actualSampleRate !== this.config.sampleRate) {
      logger.warn(`[AudioManagement] ⚠️ Sample rate mismatch! Requested: ${this.config.sampleRate}Hz, Got: ${actualSampleRate}Hz`);
      logger.warn('[AudioManagement] Adapting to system sample rate...');
      this.config.sampleRate = actualSampleRate;
    }
    
    logger.info(`[AudioManagement] AudioContext initialized with sample rate: ${actualSampleRate}Hz`);
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

  private setupAudioElementMonitor() {
    // Scan for existing audio elements
    document.querySelectorAll('audio').forEach(audio => {
      this.trackAudioElement(audio as HTMLAudioElement, 'existing');
    });
    
    // Watch for new audio elements
    this.audioElementObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLAudioElement) {
            this.trackAudioElement(node, 'added');
          }
          // Also check children of added nodes
          if (node instanceof HTMLElement) {
            node.querySelectorAll('audio').forEach(audio => {
              this.trackAudioElement(audio as HTMLAudioElement, 'added-child');
            });
          }
        }
        for (const node of mutation.removedNodes) {
          if (node instanceof HTMLAudioElement) {
            logger.warn('[AudioManagement] 🔇 Audio element removed:', {
              src: node.src || node.currentSrc,
              id: node.id,
            });
          }
        }
      }
    });
    
    this.audioElementObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    
    logger.info('[AudioManagement] 👀 Audio element monitor started');
  }
  
  private trackAudioElement(audio: HTMLAudioElement, source: string) {
    if (this.trackedAudioElements.has(audio)) return;
    if (this.mediaElements.has(audio)) return; // Ignore our own elements
    
    this.trackedAudioElements.add(audio);
    
    const info = {
      source,
      src: audio.src || audio.currentSrc || '<no src>',
      id: audio.id || '<no id>',
      className: audio.className || '<no class>',
      autoplay: audio.autoplay,
      muted: audio.muted,
      volume: audio.volume,
      paused: audio.paused,
    };
    
    logger.warn('[AudioManagement] 🔊 External <audio> detected:', info);
    console.warn('🔊 EXTERNAL AUDIO ELEMENT:', audio, info);
    
    // Track state changes
    audio.addEventListener('play', () => {
      logger.warn('[AudioManagement] 🔊 External audio PLAY:', audio.src || audio.currentSrc);
    });
    audio.addEventListener('pause', () => {
      logger.info('[AudioManagement] 🔇 External audio PAUSE:', audio.src || audio.currentSrc);
    });
    audio.addEventListener('loadstart', () => {
      logger.warn('[AudioManagement] 🔊 External audio LOADSTART:', audio.src || audio.currentSrc);
    });
  }

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
          await this.setOutputDevice('default');
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

  async setOutputDevice(deviceId: DeviceId): Promise<void> {
    logger.info("[AudioManagement] setOutputDevice:", deviceId);
    this.outputDeviceId.value = deviceId;
    localStorage.setItem(STORAGE_KEYS.OUTPUT_DEVICE, deviceId);
    
    // Use AudioContext.setSinkId if available (Chrome 110+)
    if ('setSinkId' in this.audioCtx) {
      try {
        await (this.audioCtx as any).setSinkId(deviceId);
        logger.info("[AudioManagement] AudioContext.setSinkId applied:", deviceId);
      } catch (err) {
        logger.warn("[AudioManagement] AudioContext.setSinkId failed:", err);
      }
    }
    
    // Also apply to all media elements (for incoming streams, etc.)
    for (const el of this.mediaElements) {
      this.applySinkIdToElement(el);
    }
    
    this.outputDevice$.next(deviceId);
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
    
    this.inputVolume.value = clampedVolume;
    this.inputVolume$.next(clampedVolume);
    localStorage.setItem(STORAGE_KEYS.INPUT_VOLUME, clampedVolume.toString());
    
    this.applyInputVolume();
  }

  setOutputVolume(volume: number): void {
    const clampedVolume = Math.max(0, Math.min(100, volume));
    
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
      // Note: Don't enforce exact sampleRate to avoid mismatches with AudioContext
      this.currentMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 2,
          echoCancellation: this.audioConstraints.echoCancellation,
          noiseSuppression: this.audioConstraints.noiseSuppression,
          autoGainControl: this.audioConstraints.autoGainControl,
          deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
          sampleRate: { ideal: this.config.sampleRate },
        },
      });
      
      // Validate sample rate compatibility before creating source
      const streamTrack = this.currentMicStream.getAudioTracks()[0];
      const streamSettings = streamTrack.getSettings();
      const streamSampleRate = streamSettings.sampleRate;
      
      if (streamSampleRate && streamSampleRate !== ctx.sampleRate) {
        logger.error(`[AudioManagement] ❌ Sample rate mismatch detected!`);
        logger.error(`[AudioManagement] MediaStream: ${streamSampleRate}Hz, AudioContext: ${ctx.sampleRate}Hz`);
        logger.error(`[AudioManagement] This will cause "NotSupportedError: different sample-rate" error`);
        
        // Try to recreate AudioContext with correct sample rate
        logger.warn(`[AudioManagement] Attempting to recreate AudioContext with ${streamSampleRate}Hz...`);
        
        // Close old context
        const oldContext = this.audioCtx;
        await oldContext.close();
        
        // Create new context with correct sample rate
        this.audioCtx = new AudioContext({ sampleRate: streamSampleRate });
        this.config.sampleRate = streamSampleRate;
        
        // Reinitialize virtual output stream
        this.virtualOutputInitialized = false;
        this.initVirtualOutputStream();
        
        // Update ctx reference
        const newCtx = this.audioCtx;
        
        // Recreate nodes with new context
        this.virtualStreamDestination = newCtx.createMediaStreamDestination();
        this.inputGainNode = newCtx.createGain();
        this.inputGainNode.connect(this.virtualStreamDestination);
        this.applyInputVolume();
        
        logger.info(`[AudioManagement] ✅ AudioContext recreated with ${streamSampleRate}Hz`);
      }
      
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
          sampleRate: { ideal: this.config.sampleRate },
        },
      });
    } catch (err) {
      logger.error("[AudioManagement] Failed to get user media:", err);
      throw err;
    }
  }

  // ==================== VIRTUAL OUTPUT STREAM ====================

  /**
   * Initialize the virtual output stream.
   * This creates a permanent audio pipeline:
   * masterGainNode -> analyser -> destination
   * 
   * All sounds should connect to getOutputDestination() to respect volume/mute settings.
   * Output device is changed via AudioContext.setSinkId() (Chrome 110+).
   */
  private initVirtualOutputStream(): void {
    if (this.virtualOutputInitialized) return;
    
    const ctx = this.audioCtx;
    
    // Create analyser node for output level monitoring
    this.outputAnalyserNode = ctx.createAnalyser();
    this.outputAnalyserNode.fftSize = 256;
    this.outputAnalyserNode.smoothingTimeConstant = 0.3;
    this.outputAnalyserNode.connect(ctx.destination);
    
    // Create master gain node for volume control
    this.masterGainNode = ctx.createGain();
    this.masterGainNode.connect(this.outputAnalyserNode);
    this.applyOutputVolume();
    
    // Apply saved output device via AudioContext.setSinkId
    if ('setSinkId' in ctx && this.outputDeviceId.value && this.outputDeviceId.value !== 'default') {
      (ctx as any).setSinkId(this.outputDeviceId.value).catch((err: any) => {
        logger.warn('[AudioManagement] Initial setSinkId failed:', err);
      });
    }
    
    // Start output level monitoring using analyser
    this.startOutputLevelMonitoring();
    
    this.virtualOutputInitialized = true;
    logger.info('[AudioManagement] Virtual output stream initialized');
  }

  private startOutputLevelMonitoring(): void {
    if (this.outputLevelAnimationFrame || !this.outputAnalyserNode) return;
    
    const analyser = this.outputAnalyserNode;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate RMS level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const level = Math.min(100, (rms / 128) * 100);
      
      this.outputLevel$.next(Math.round(level));
      
      this.outputLevelAnimationFrame = requestAnimationFrame(updateLevel);
    };
    
    this.outputLevelAnimationFrame = requestAnimationFrame(updateLevel);
  }

  /**
   * Check if virtual output stream is initialized
   */
  isVirtualOutputInitialized(): boolean {
    return this.virtualOutputInitialized;
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

  onOutputLevelChanged(on: (level: number) => void): Subscription {
    return this.outputLevel$.subscribe(on);
  }

  /**
   * Report output level (called by external audio playback systems)
   */
  reportOutputLevel(level: number): void {
    this.outputLevel$.next(level);
  }

  /**
   * Check if virtual input stream is initialized
   */
  isVirtualStreamInitialized(): boolean {
    return this.virtualStreamInitialized;
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

  // ==================== REMOTE PARTICIPANT AUDIO ====================

  /**
   * Create an audio graph for a remote participant.
   * Routes audio through master gain for volume/mute control.
   * Includes speaking detection via analyser node.
   */
  createRemoteAudioGraph(options: RemoteAudioGraphOptions): RemoteAudioGraph {
    const {
      track,
      label = 'Remote Audio',
      initialVolume = 100,
      isMutedAll = false,
      onSpeakingChange,
      speakingThreshold = 0.001,
    } = options;

    const graphId = v4();
    const ctx = this.getCurrentAudioContext();
    const mediaStream = new MediaStream([track]);

    // Register this graph
    this.remoteAudioGraphs.set(graphId, { label, volume: initialVolume, speaking: false });

    // Create hidden audio element for playback (needed for some browsers)
    const el = document.createElement('audio');
    el.autoplay = true;
    el.muted = true; // Muted because we route through Web Audio API
    el.style.display = 'none';
    el.srcObject = mediaStream;
    el.dataset.weakSlaveTrack = v4();
    document.body.appendChild(el);
    this.mediaElements.add(el);

    // Create audio graph nodes
    const gainNode = ctx.createGain();
    
    // Try MediaStreamSource first, fall back to MediaElementSource
    let sourceNode: AudioNode;
    try {
      sourceNode = ctx.createMediaStreamSource(mediaStream);
    } catch {
      sourceNode = ctx.createMediaElementSource(el);
    }

    // Create analyser for speaking detection
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const buffer = new Float32Array(analyser.fftSize);

    // Connect: source -> analyser -> gain -> masterGain (output destination)
    sourceNode.connect(analyser);
    analyser.connect(gainNode);
    gainNode.connect(this.getOutputDestination());

    // Apply initial volume
    let currentVolume = initialVolume;
    const applyVolume = (vol: number) => {
      const g = isMutedAll ? 0 : Math.max(0, Math.min(vol / 100, 2.0));
      gainNode.gain.setValueAtTime(g, ctx.currentTime);
    };
    applyVolume(initialVolume);

    // Speaking detection
    let speakingState = false;
    let stopped = false;

    const detect = () => {
      if (stopped) return;

      analyser.getFloatTimeDomainData(buffer);

      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length);
      const newState = rms > speakingThreshold;

      if (newState !== speakingState) {
        speakingState = newState;
        // Update tracking
        const graphInfo = this.remoteAudioGraphs.get(graphId);
        if (graphInfo) graphInfo.speaking = speakingState;
        onSpeakingChange?.(speakingState);
      }

      requestAnimationFrame(detect);
    };

    // Always run detection to track speaking state
    detect();

    const setVolume = (volume: number) => {
      currentVolume = volume;
      applyVolume(volume);
      // Update tracking
      const graphInfo = this.remoteAudioGraphs.get(graphId);
      if (graphInfo) graphInfo.volume = volume;
    };

    const getVolume = () => currentVolume;

    const dispose = () => {
      stopped = true;
      // Remove from tracking
      this.remoteAudioGraphs.delete(graphId);
      try {
        gainNode.disconnect();
        analyser.disconnect();
        sourceNode.disconnect();
        el.pause();
        el.srcObject = null;
        this.mediaElements.delete(el);
        el.remove();
      } catch (err) {
        logger.warn('[AudioManagement] Error disposing remote audio graph:', err);
      }
    };

    return {
      graphId,
      gainNode,
      setVolume,
      getVolume,
      dispose,
    };
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

  /**
   * Create a stereo VU meter that reports separate left and right channel levels.
   * Uses vu-meter-processor.js worklet.
   */
  async createVUMeterStereo(
    stream: MediaStream,
    onLevel: (left: number, right: number) => void
  ): Promise<Disposable<AudioWorkletNode>> {
    const ctx = this.getCurrentAudioContext();
    
    // Add worklet module if not already added
    if (!this.workletPaths.has('vu-meter-processor')) {
      const workletPath = `${this.config.workletBasePath}/vu-meter-processor.js`;
      await ctx.audioWorklet.addModule(workletPath);
      this.workletPaths.set('vu-meter-processor', workletPath);
    }
    
    const sourceNode = ctx.createMediaStreamSource(stream);
    const vuMeter = new AudioWorkletNode(ctx, 'vu-meter-processor');
    
    vuMeter.port.onmessage = (event) => {
      const data = event.data as Float32Array;
      // data[0] = left channel, data[1] = right channel
      const left = Math.min(100, data[0] * 150);
      const right = Math.min(100, data[1] * 150);
      onLevel(Math.round(left), Math.round(right));
    };
    
    sourceNode.connect(vuMeter);
    
    const dispose = async (node: AudioWorkletNode) => {
      logger.debug('[AudioManagement] Disposing stereo VU meter');
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

  /**
   * Create a stereo VU meter on the virtual input stream.
   */
  async createVirtualVUMeterStereo(
    onLevel: (left: number, right: number) => void
  ): Promise<Disposable<AudioWorkletNode>> {
    const virtualStream = await this.getVirtualInputStream();
    return this.createVUMeterStereo(virtualStream, onLevel);
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

  /**
   * Get the output destination node.
   * All audio that should respect output volume/mute should connect to this node.
   */
  getOutputDestination(): AudioNode {
    return this.masterGainNode ?? this.audioCtx.destination;
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

  getActiveWorklets(): Map<string, AudioWorkletNode> {
    return new Map(this.worklets);
  }

  /**
   * Get all tracked remote audio graphs
   */
  getRemoteAudioGraphs(): Map<string, { label: string; volume: number; speaking: boolean }> {
    return new Map(this.remoteAudioGraphs);
  }

  /**
   * Get all tracked media elements
   */
  getMediaElements(): Set<HTMLMediaElement> {
    return new Set(this.mediaElements);
  }
}
