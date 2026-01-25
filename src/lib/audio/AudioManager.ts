// Re-export from @argon/audio package
import { AudioManagement as BaseAudioManagement, type IAudioManagement, createDTMFPlayer } from "@argon/audio";
import { WebRTCProcessor } from "./WebRTCProcessor";

export type { IAudioManagement, DeviceId, WorkletPath, WorkletId, AudioManagerConfig, DTMFPlayer, RemoteAudioGraph, RemoteAudioGraphOptions } from "@argon/audio";

// Extended AudioManagement with app-specific features
class AppAudioManagement extends BaseAudioManagement {
  createRtcProcessor(): WebRTCProcessor {
    return new WebRTCProcessor(this);
  }
}

// App-specific audio instance with worklet path pointing to public/audio
const audio = new AppAudioManagement({
  workletBasePath: '/audio',
  sampleRate: 48000,
});

// App-specific DTMF player
export const dtmfPlayer = createDTMFPlayer(audio);
export const playDTMF = dtmfPlayer.playDTMF;
export const playBusyTone = dtmfPlayer.playBusyTone;

export { audio };
