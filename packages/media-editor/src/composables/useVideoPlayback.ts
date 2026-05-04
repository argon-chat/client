import { ref, onBeforeUnmount, watch, type Ref } from 'vue';

export interface VideoPlaybackState {
  isPlaying: Ref<boolean>;
  currentTime: Ref<number>;
  duration: Ref<number>;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  video: Ref<HTMLVideoElement | null>;
}

export function useVideoPlayback(src: Ref<string>): VideoPlaybackState {
  const video = ref<HTMLVideoElement | null>(null);
  const isPlaying = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);

  let animFrameId: number | null = null;

  function createVideo() {
    if (video.value) {
      video.value.pause();
      video.value.src = '';
    }

    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.src = src.value;

    el.addEventListener('loadedmetadata', () => {
      duration.value = el.duration;
    });

    el.addEventListener('ended', () => {
      isPlaying.value = false;
    });

    video.value = el;
  }

  watch(src, (newSrc) => {
    if (newSrc) createVideo();
  }, { immediate: true });

  function play() {
    if (!video.value) return;
    video.value.play();
    isPlaying.value = true;
    tick();
  }

  function pause() {
    if (!video.value) return;
    video.value.pause();
    isPlaying.value = false;
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function seek(time: number) {
    if (!video.value) return;
    video.value.currentTime = time;
    currentTime.value = time;
  }

  function tick() {
    if (!video.value || !isPlaying.value) return;
    currentTime.value = video.value.currentTime;
    animFrameId = requestAnimationFrame(tick);
  }

  onBeforeUnmount(() => {
    pause();
    if (video.value) {
      video.value.src = '';
      video.value = null;
    }
  });

  return {
    isPlaying,
    currentTime,
    duration,
    play,
    pause,
    seek,
    video: video as Ref<HTMLVideoElement | null>
  };
}
