// @argon/calls - Speaking detection utilities

import { Subscription } from "rxjs";

export interface SpeakingDetectorOptions {
  audioContext: AudioContext;
  mediaStreamTrack: MediaStreamTrack;
  userId: string;
  threshold?: number;
  onSpeakingChange: (userId: string, isSpeaking: boolean) => void;
  /** Optional check for mute state */
  isMuted?: () => boolean;
}

/**
 * Create a speaking detector for a media stream track
 */
export function createSpeakingDetector(options: SpeakingDetectorOptions): Subscription {
  const {
    audioContext,
    mediaStreamTrack,
    userId,
    threshold = 0.001,
    onSpeakingChange,
    isMuted = () => false,
  } = options;

  const mediaStream = new MediaStream([mediaStreamTrack]);
  const src = audioContext.createMediaStreamSource(mediaStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;

  const buffer = new Float32Array(analyser.fftSize);

  src.connect(analyser);

  let speakingState = false;
  let stopped = false;

  function detect() {
    if (stopped) return;

    analyser.getFloatTimeDomainData(buffer);

    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sum / buffer.length);

    // Check if muted - if so, don't show speaking indicator
    const muted = isMuted();
    const newState = !muted && rms > threshold;

    if (newState !== speakingState) {
      speakingState = newState;
      onSpeakingChange(userId, speakingState);
    }

    requestAnimationFrame(detect);
  }

  detect();

  return new Subscription(() => {
    stopped = true;
    onSpeakingChange(userId, false);
  });
}
