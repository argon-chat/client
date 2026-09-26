// @argon/calls - The broadcaster's radio connection
//
// A second LiveKit room, `radio/{space}/{HQ}`, joined as `bc:{userId}` with a token that lets
// the participant publish a microphone and nothing else. The SFU forwards it into the target
// rooms. The track is a clone of the call's virtual input, published muted; the key unmutes it.
// The session owns the room and the track only — links, confirmation and retries are the
// manager's.

import { AudioPresets, LocalAudioTrack, RoomEvent, Track, type DisconnectReason, type Room, type RoomOptions } from "livekit-client";
import { logger } from "@argon/core";
import type { RtcEndpoint } from "@argon/glue";

export interface RadioSessionDeps {
  createRoom(options: RoomOptions): Room;
  connect(room: Room, rtc: RtcEndpoint, token: string): Promise<void>;
  audioContext(): AudioContext;
  /** The call's virtual input; null once the call is gone. */
  micSource(): MediaStreamTrack | null;
  /** After every full reconnect: the forward has to be confirmed again. */
  onReconnected(): void;
  onDisconnected(reason: DisconnectReason | undefined): void;
}

export class RadioSession {
  readonly room: Room;
  private track: LocalAudioTrack | null = null;
  private clone: MediaStreamTrack | null = null;
  private closed = false;

  constructor(private readonly deps: RadioSessionDeps, loggerName: string) {
    this.room = deps.createRoom({
      loggerName,
      adaptiveStream: false,
      dynacast: false,
      webAudioMix: { audioContext: deps.audioContext() },
    });
    this.room.on(RoomEvent.Reconnected, () => {
      if (!this.closed) this.deps.onReconnected();
    });
    this.room.on(RoomEvent.Disconnected, (reason) => {
      if (!this.closed) this.deps.onDisconnected(reason);
    });
  }

  get isClosed() {
    return this.closed;
  }

  get isTransmitting() {
    return !!this.track && !this.track.isMuted;
  }

  /** Connect and publish the muted microphone. Resolves false when closed meanwhile. */
  async connect(rtc: RtcEndpoint, token: string): Promise<boolean> {
    void this.room.prepareConnection(rtc.endpoint, token);
    await this.deps.connect(this.room, rtc, token);
    if (this.closed) return false;

    const source = this.deps.micSource();
    if (!source) throw new Error("No microphone source for the radio");

    // A clone: LiveKit stopping its track on disconnect leaves the call's input alone.
    const clone = source.clone();
    const mic = new LocalAudioTrack(clone, undefined, true, this.deps.audioContext());
    mic.source = Track.Source.Microphone;
    // Muted before it is published: nothing reaches the targets until the key.
    await mic.mute();
    try {
      await this.room.localParticipant.publishTrack(mic, {
        red: true,
        dtx: true,
        stopMicTrackOnMute: false,
        audioPreset: AudioPresets.speech,
        forceStereo: false,
      });
    } catch (err) {
      try { clone.stop?.(); } catch { /* already stopped */ }
      throw err;
    }
    if (this.closed) {
      try { clone.stop?.(); } catch { /* already stopped */ }
      return false;
    }
    this.track = mic;
    this.clone = clone;
    return true;
  }

  async setTransmitting(on: boolean): Promise<void> {
    const track = this.track;
    if (!track || this.closed) return;
    if (on) await track.unmute();
    else await track.mute();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const track = this.track;
    this.track = null;
    if (track && !track.isMuted) {
      track.mute().catch((e) => logger.warn("[RADIO] mute on close failed", e));
    }
    try {
      this.room.removeAllListeners();
      this.room.disconnect();
    } catch (err) {
      logger.warn("[RADIO] disconnect failed", err);
    }
    try { this.clone?.stop?.(); } catch { /* already stopped */ }
    this.clone = null;
  }
}
