import type { Ref, ComputedRef } from "vue-demi";

export type MaybeRef<T> = T | Ref<T> | ComputedRef<T>;

/**
 * Sprite definition: [startMs, durationMs]
 */
export type SpriteDefinition = [number, number];

/**
 * Sprite map for audio atlas
 */
export interface SpriteMap {
  [key: string]: SpriteDefinition;
}

/**
 * Sound instance state
 */
export type SoundState = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

/**
 * Play options for a single sound
 */
export interface PlayOptions {
  /** Sprite ID to play (if using sprites) */
  id?: string;
  /** Override volume for this play (0-1) */
  volume?: number;
  /** Override playback rate for this play */
  rate?: number;
  /** Loop this specific play */
  loop?: boolean;
  /** Fade in duration in ms */
  fadeIn?: number;
  /** Pan position (-1 left, 0 center, 1 right) */
  pan?: number;
  /** Delay before playing in ms */
  delay?: number;
  /** Force play even if soundEnabled is false */
  forceSoundEnabled?: boolean;
  /** Callback when this specific play ends */
  onEnd?: () => void;
}

/**
 * Active sound instance
 */
export interface SoundInstance {
  /** Unique instance ID */
  id: number;
  /** Sprite ID if playing a sprite */
  spriteId?: string;
  /** Source node */
  source: AudioBufferSourceNode;
  /** Gain node for this instance */
  gain: GainNode;
  /** Panner node if pan is used */
  panner?: StereoPannerNode;
  /** Whether this instance is playing */
  playing: boolean;
  /** Whether this instance is looping */
  loop: boolean;
  /** Start time */
  startTime: number;
  /** Duration */
  duration: number;
  /** Callbacks */
  onEnd?: () => void;
}

/**
 * Sound player configuration
 */
export interface SoundPlayerOptions {
  /** Base volume (0-1), can be reactive */
  volume?: MaybeRef<number>;
  /** Playback rate, can be reactive */
  rate?: MaybeRef<number>;
  /** Whether sound is enabled globally */
  soundEnabled?: MaybeRef<boolean>;
  /** Sprite definitions for atlas */
  sprite?: SpriteMap;
  /** Custom AudioContext */
  audioContext?: AudioContext;
  /** Custom destination node (for routing through master gain) */
  destination?: AudioNode;
  /** Auto-preload the audio */
  preload?: boolean;
  /** Default loop setting */
  loop?: boolean;
  /** Pool size for concurrent plays of same sound */
  poolSize?: number;
  /** Callback when audio is loaded */
  onLoad?: (duration: number) => void;
  /** Callback when audio fails to load */
  onError?: (error: Error) => void;
  /** Callback when any instance ends */
  onEnd?: (spriteId?: string) => void;
}

/**
 * Sound player return value
 */
export interface SoundPlayer {
  /** Play the sound or a sprite */
  play: (options?: PlayOptions) => number;
  /** Stop a specific instance or all instances */
  stop: (instanceId?: number) => void;
  /** Pause a specific instance or all instances */
  pause: (instanceId?: number) => void;
  /** Resume a specific instance or all instances */
  resume: (instanceId?: number) => void;
  /** Fade out and stop */
  fadeOut: (duration: number, instanceId?: number) => void;
  /** Set volume */
  setVolume: (volume: number) => void;
  /** Set playback rate */
  setRate: (rate: number) => void;
  /** Check if any instance is playing */
  isPlaying: Ref<boolean>;
  /** Current state */
  state: Ref<SoundState>;
  /** Total duration in ms */
  duration: Ref<number>;
  /** Active instances count */
  activeCount: Ref<number>;
  /** Seek to position (only for non-sprite, single instance) */
  seek: (position: number, instanceId?: number) => void;
  /** Get current position */
  getPosition: (instanceId?: number) => number;
  /** Unload and cleanup */
  unload: () => void;
}

/**
 * Audio atlas configuration
 */
export interface AudioAtlasConfig {
  /** Source URL or URLs (for format fallback) */
  src: string | string[];
  /** Sprite definitions */
  sprites: SpriteMap;
  /** Default options for all sprites */
  defaultOptions?: Omit<SoundPlayerOptions, 'sprite'>;
}

/**
 * Audio atlas player
 */
export interface AudioAtlas {
  /** Play a sprite by ID */
  play: (spriteId: string, options?: Omit<PlayOptions, 'id'>) => number;
  /** Stop playing sprite(s) */
  stop: (spriteId?: string, instanceId?: number) => void;
  /** Check if loaded */
  isLoaded: Ref<boolean>;
  /** Check if a specific sprite is playing */
  isPlaying: (spriteId?: string) => boolean;
  /** Set master volume */
  setVolume: (volume: number) => void;
  /** Unload atlas */
  unload: () => void;
}
