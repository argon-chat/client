import type {
  MaybeRef,
  PlayOptions,
  SoundInstance,
  SoundPlayer,
  SoundPlayerOptions,
  SoundState,
  SpriteMap,
  AudioAtlas,
  AudioAtlasConfig,
} from "./types";
import { onMounted, onUnmounted, ref, unref, watch, type Ref } from "vue-demi";

export * from "./types";

// Global instance counter
let instanceIdCounter = 0;

// Global audio context (lazy init)
let globalAudioContext: AudioContext | null = null;

/**
 * Get or create the global AudioContext
 */
export function getGlobalAudioContext(): AudioContext {
  if (!globalAudioContext) {
    globalAudioContext = new AudioContext();
  }
  if (globalAudioContext.state === 'suspended') {
    globalAudioContext.resume();
  }
  return globalAudioContext;
}

/**
 * Audio buffer cache for reusing loaded audio
 */
const bufferCache = new Map<string, AudioBuffer>();

/**
 * Load audio buffer from URL with caching
 */
async function loadAudioBuffer(
  url: string,
  audioContext: AudioContext
): Promise<AudioBuffer> {
  // Check cache first
  const cached = bufferCache.get(url);
  if (cached) return cached;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load audio: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  // Cache the buffer
  bufferCache.set(url, audioBuffer);
  
  return audioBuffer;
}

/**
 * Clear the audio buffer cache
 */
export function clearAudioCache(url?: string): void {
  if (url) {
    bufferCache.delete(url);
  } else {
    bufferCache.clear();
  }
}

/**
 * Create a sound player - core function (non-Vue)
 */
export function createSoundPlayer(
  url: string,
  options: SoundPlayerOptions = {}
): SoundPlayer {
  const {
    volume: initialVolume = 1,
    rate: initialRate = 1,
    soundEnabled: initialSoundEnabled = true,
    sprite,
    audioContext: customContext,
    destination,
    preload = true,
    loop: defaultLoop = false,
    poolSize = 10,
    onLoad,
    onError,
    onEnd,
  } = options;

  // State
  const state = ref<SoundState>("idle");
  const isPlaying = ref(false);
  const duration = ref(0);
  const activeCount = ref(0);
  
  // Internal state
  let audioContext: AudioContext;
  let audioBuffer: AudioBuffer | null = null;
  let masterGain: GainNode;
  let currentVolume = unref(initialVolume);
  let currentRate = unref(initialRate);
  let isSoundEnabled = unref(initialSoundEnabled);
  const instances = new Map<number, SoundInstance>();

  // Initialize audio context and master gain
  function initContext(): void {
    audioContext = customContext || getGlobalAudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = currentVolume;
    masterGain.connect(destination || audioContext.destination);
  }

  // Load audio
  async function load(): Promise<void> {
    if (state.value === "loading" || state.value === "ready") return;
    
    state.value = "loading";
    initContext();

    try {
      audioBuffer = await loadAudioBuffer(url, audioContext);
      duration.value = audioBuffer.duration * 1000;
      state.value = "ready";
      onLoad?.(duration.value);
    } catch (err) {
      state.value = "error";
      onError?.(err as Error);
      throw err;
    }
  }

  // Start loading if preload is enabled
  if (preload) {
    // Defer to next tick to allow Vue setup to complete
    Promise.resolve().then(() => load().catch(() => {}));
  }

  // Create and play a sound instance
  function play(playOptions: PlayOptions = {}): number {
    const {
      id: spriteId,
      volume: playVolume,
      rate: playRate,
      loop = defaultLoop,
      fadeIn,
      pan,
      delay = 0,
      forceSoundEnabled = false,
      onEnd: playOnEnd,
    } = playOptions;

    // Check if sound is enabled
    if (!forceSoundEnabled && !isSoundEnabled) {
      return -1;
    }

    // Ensure loaded
    if (!audioBuffer) {
      load().then(() => play(playOptions)).catch(() => {});
      return -1;
    }

    // Limit concurrent instances
    if (instances.size >= poolSize) {
      // Stop oldest instance
      const oldest = instances.values().next().value;
      if (oldest) {
        stopInstance(oldest.id);
      }
    }

    // Determine start position and duration from sprite or full buffer
    let startTime = 0;
    let playDuration = audioBuffer.duration;

    if (spriteId && sprite && sprite[spriteId]) {
      const [startMs, durationMs] = sprite[spriteId];
      startTime = startMs / 1000;
      playDuration = durationMs / 1000;
    }

    // Create nodes
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = playRate ?? currentRate;
    source.loop = loop;
    
    if (loop && spriteId && sprite && sprite[spriteId]) {
      // For looping sprites, set loop points
      source.loopStart = startTime;
      source.loopEnd = startTime + playDuration;
    }

    const instanceGain = audioContext.createGain();
    const effectiveVolume = playVolume ?? 1;
    
    if (fadeIn) {
      instanceGain.gain.setValueAtTime(0, audioContext.currentTime);
      instanceGain.gain.linearRampToValueAtTime(
        effectiveVolume,
        audioContext.currentTime + fadeIn / 1000
      );
    } else {
      instanceGain.gain.value = effectiveVolume;
    }

    // Connect nodes
    let lastNode: AudioNode = source;
    
    // Add panner if pan is specified
    let pannerNode: StereoPannerNode | undefined;
    if (pan !== undefined && 'createStereoPanner' in audioContext) {
      pannerNode = audioContext.createStereoPanner();
      pannerNode.pan.value = Math.max(-1, Math.min(1, pan));
      lastNode.connect(pannerNode);
      lastNode = pannerNode;
    }
    
    lastNode.connect(instanceGain);
    instanceGain.connect(masterGain);

    // Create instance
    const instanceId = ++instanceIdCounter;
    const instance: SoundInstance = {
      id: instanceId,
      spriteId,
      source,
      gain: instanceGain,
      panner: pannerNode,
      playing: true,
      loop,
      startTime: audioContext.currentTime + delay / 1000,
      duration: playDuration * 1000,
      onEnd: playOnEnd,
    };

    instances.set(instanceId, instance);
    updateState();

    // Handle end
    source.onended = () => {
      if (instances.has(instanceId)) {
        const inst = instances.get(instanceId)!;
        inst.playing = false;
        instances.delete(instanceId);
        updateState();
        inst.onEnd?.();
        onEnd?.(spriteId);
      }
    };

    // Start playback
    const startAt = audioContext.currentTime + delay / 1000;
    if (loop) {
      source.start(startAt, startTime);
    } else {
      source.start(startAt, startTime, playDuration);
    }

    return instanceId;
  }

  // Stop instance(s)
  function stopInstance(instanceId?: number): void {
    if (instanceId !== undefined) {
      const instance = instances.get(instanceId);
      if (instance) {
        try {
          instance.source.stop();
        } catch {}
        instance.playing = false;
        instances.delete(instanceId);
      }
    } else {
      // Stop all
      for (const instance of instances.values()) {
        try {
          instance.source.stop();
        } catch {}
        instance.playing = false;
      }
      instances.clear();
    }
    updateState();
  }

  // Pause instance(s) - note: Web Audio doesn't have native pause, we simulate it
  function pause(instanceId?: number): void {
    // Web Audio API doesn't support true pause, so we just stop
    // For proper pause/resume, would need to track position and recreate source
    stopInstance(instanceId);
  }

  // Resume - not really possible with Web Audio without recreating
  function resume(instanceId?: number): void {
    // Would need to reimplement with position tracking
    console.warn('Resume not fully supported - use play() instead');
  }

  // Fade out
  function fadeOut(durationMs: number, instanceId?: number): void {
    const targetInstances = instanceId !== undefined 
      ? [instances.get(instanceId)].filter(Boolean)
      : Array.from(instances.values());

    const endTime = audioContext.currentTime + durationMs / 1000;
    
    for (const instance of targetInstances) {
      if (!instance) continue;
      instance.gain.gain.linearRampToValueAtTime(0, endTime);
      
      // Schedule stop
      setTimeout(() => {
        stopInstance(instance.id);
      }, durationMs);
    }
  }

  // Set volume
  function setVolume(volume: number): void {
    currentVolume = Math.max(0, Math.min(1, volume));
    if (masterGain) {
      masterGain.gain.setValueAtTime(currentVolume, audioContext.currentTime);
    }
  }

  // Set rate
  function setRate(rate: number): void {
    currentRate = Math.max(0.1, Math.min(4, rate));
    for (const instance of instances.values()) {
      instance.source.playbackRate.setValueAtTime(currentRate, audioContext.currentTime);
    }
  }

  // Update reactive state
  function updateState(): void {
    activeCount.value = instances.size;
    isPlaying.value = instances.size > 0;
    state.value = instances.size > 0 ? "playing" : (audioBuffer ? "ready" : state.value);
  }

  // Seek (limited support)
  function seek(position: number, instanceId?: number): void {
    console.warn('Seek requires stopping and restarting playback');
  }

  // Get position (limited support)
  function getPosition(instanceId?: number): number {
    if (instanceId !== undefined) {
      const instance = instances.get(instanceId);
      if (instance && instance.playing) {
        return (audioContext.currentTime - instance.startTime) * 1000;
      }
    }
    return 0;
  }

  // Unload
  function unload(): void {
    stopInstance();
    audioBuffer = null;
    state.value = "idle";
    duration.value = 0;
  }

  // Watch reactive values
  if (typeof initialVolume === 'object' && 'value' in initialVolume) {
    watch(initialVolume as Ref<number>, (v) => setVolume(v));
  }
  if (typeof initialRate === 'object' && 'value' in initialRate) {
    watch(initialRate as Ref<number>, (v) => setRate(v));
  }
  if (typeof initialSoundEnabled === 'object' && 'value' in initialSoundEnabled) {
    watch(initialSoundEnabled as Ref<boolean>, (v) => { isSoundEnabled = v; });
  }

  return {
    play,
    stop: stopInstance,
    pause,
    resume,
    fadeOut,
    setVolume,
    setRate,
    isPlaying,
    state,
    duration,
    activeCount,
    seek,
    getPosition,
    unload,
  };
}

/**
 * Vue composable for sound playback
 */
export function useSound(
  url: MaybeRef<string>,
  options: SoundPlayerOptions = {}
): SoundPlayer {
  const resolvedUrl = unref(url);
  const player = createSoundPlayer(resolvedUrl, options);

  // Handle URL changes
  if (typeof url === 'object' && 'value' in url) {
    watch(url as Ref<string>, (newUrl) => {
      player.unload();
      // Create new player would require more complex state management
      console.warn('URL change requires component remount');
    });
  }

  // Cleanup on unmount
  onUnmounted(() => {
    player.stop();
  });

  return player;
}

/**
 * Create an audio atlas for sprite-based playback
 */
export function createAudioAtlas(config: AudioAtlasConfig): AudioAtlas {
  const { src, sprites, defaultOptions = {} } = config;
  const url = Array.isArray(src) ? src[0] : src;
  
  const isLoaded = ref(false);
  const player = createSoundPlayer(url, {
    ...defaultOptions,
    sprite: sprites,
    onLoad: () => {
      isLoaded.value = true;
      defaultOptions.onLoad?.(player.duration.value);
    },
  });

  // Track playing sprites
  const playingSpriteInstances = new Map<string, Set<number>>();

  function play(spriteId: string, options: Omit<PlayOptions, 'id'> = {}): number {
    if (!sprites[spriteId]) {
      console.warn(`Sprite "${spriteId}" not found in atlas`);
      return -1;
    }

    const instanceId = player.play({ ...options, id: spriteId });
    
    if (instanceId !== -1) {
      if (!playingSpriteInstances.has(spriteId)) {
        playingSpriteInstances.set(spriteId, new Set());
      }
      playingSpriteInstances.get(spriteId)!.add(instanceId);
    }

    return instanceId;
  }

  function stop(spriteId?: string, instanceId?: number): void {
    if (instanceId !== undefined) {
      player.stop(instanceId);
      // Clean up tracking
      for (const instances of playingSpriteInstances.values()) {
        instances.delete(instanceId);
      }
    } else if (spriteId) {
      const instances = playingSpriteInstances.get(spriteId);
      if (instances) {
        for (const id of instances) {
          player.stop(id);
        }
        instances.clear();
      }
    } else {
      player.stop();
      playingSpriteInstances.clear();
    }
  }

  function isPlayingSprite(spriteId?: string): boolean {
    if (spriteId) {
      const instances = playingSpriteInstances.get(spriteId);
      return instances ? instances.size > 0 : false;
    }
    return player.isPlaying.value;
  }

  function setVolume(volume: number): void {
    player.setVolume(volume);
  }

  function unload(): void {
    player.unload();
    playingSpriteInstances.clear();
    isLoaded.value = false;
  }

  return {
    play,
    stop,
    isLoaded,
    isPlaying: isPlayingSprite,
    setVolume,
    unload,
  };
}

/**
 * Vue composable for audio atlas
 */
export function useAudioAtlas(config: AudioAtlasConfig): AudioAtlas {
  const atlas = createAudioAtlas(config);

  onUnmounted(() => {
    atlas.stop();
  });

  return atlas;
}

/**
 * Preload multiple audio files
 */
export async function preloadAudio(
  urls: string[],
  audioContext?: AudioContext
): Promise<void> {
  const ctx = audioContext || getGlobalAudioContext();
  await Promise.all(urls.map(url => loadAudioBuffer(url, ctx)));
}

/**
 * One-shot sound play (fire and forget)
 */
export function playSound(
  url: string,
  options: PlayOptions & { audioContext?: AudioContext; destination?: AudioNode } = {}
): number {
  const { audioContext, destination, ...playOptions } = options;
  const player = createSoundPlayer(url, {
    audioContext,
    destination,
    preload: true,
    poolSize: 1,
  });
  
  return player.play(playOptions);
}
