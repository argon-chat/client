import { defineStore } from "pinia";
import { useApi } from "./apiStore";
import { ref } from "vue";
import { logger } from "@argon/core";
import { interval, Subject } from "rxjs";
import { debounceTime, switchMap } from "rxjs/operators";
import { ActivityPresenceKind } from "@argon/glue";
import {
  AudioPlaying,
  AudioPlayingEnd,
  ProcessEnd,
  ProcessPlaying,
} from "@argon/glue/ipc";
import { native } from "@argon/glue/native";

type Presence = {
  kind: ActivityPresenceKind;
  titleName: string;
} | null;

export interface IMusicEvent {
  title: string;
  author: string;
  isPlaying: boolean;
}

export const useActivity = defineStore("activity", () => {
  const api = useApi();
  const activeActivity = ref(null as null | number);
  const gameSessions: Map<number, ProcessPlaying> = new Map();
  const musicSessions: Map<string, IMusicEvent> = new Map();
  const onActivityChanged = new Subject();
  const lastPublishedPresence = ref<Presence>(null);

  const debouncedActivitySubject = onActivityChanged.pipe(debounceTime(1000));

  async function init() {
    if (!argon.isArgonHost) return;
    const populatePinnedFn = argon.on<ProcessPlaying>("ProcessPlaying", (x) => {
      onActivityDetected(x);
    });
    if (!(await native.hostProc.onGameActivityDetected(populatePinnedFn)))
      logger.error("failed to bind activity manager 1");
    const terminatedPinnedFn = argon.on<ProcessEnd>("ProcessEnd", (x) => {
      onActivityTerminated(x);
    });
    if (!(await native.hostProc.onGameActivityTerminated(terminatedPinnedFn)))
      logger.error("failed to bind activity manager 2");
    const onMusicPlay_pin = argon.on<AudioPlaying>("AudioPlaying", (x) => {
      onMusicPlay(x);
    });
    if (
      !(await native.hostProc.onMusicSessionPlayStateChanged(onMusicPlay_pin))
    )
      logger.error("failed to bind activity manager 4");

    const onMusicStop_pin = argon.on<AudioPlayingEnd>(
      "AudioPlayingEnd",
      (x) => {
        onMusicStop(x);
      }
    );
    if (
      !(await native.hostProc.onMusicSessionStopStateChanged(onMusicStop_pin))
    )
      logger.error("failed to bind activity manager 5");

    debouncedActivitySubject.subscribe(publishLatestActivity);
    interval(2 * 60 * 1000)
      .pipe(
        switchMap(() => {
          return Promise.resolve(publishLatestActivity());
        })
      )
      .subscribe();
    native.hostProc.listenActivity();
    native.hostProc.listenSessionMusic();
  }
  function onMusicStop(ev: AudioPlayingEnd) {
    const audioEntity = ev;
    const vl = musicSessions.get(audioEntity.sessionId);

    if (!vl) return;

    vl.isPlaying = false;

    musicSessions.set(audioEntity.sessionId, vl);
    onActivityChanged.next(0);
  }

  function onMusicPlay(ev: AudioPlaying) {
    const audioEntity = ev;
    musicSessions.set(audioEntity.sessionId, {
      author: audioEntity.author,
      isPlaying: true,
      title: audioEntity.titleName,
    });
    onActivityChanged.next(0);
  }

  function onActivityDetected(proc: ProcessPlaying) {
    logger.info("onActivityDetected", proc);
    gameSessions.set(proc.pid, proc);
    activeActivity.value = proc.pid;
    onActivityChanged.next(0);
  }

  function onActivityTerminated(end: ProcessEnd) {
    logger.info("onActivityTerminated", end.pid);

    gameSessions.delete(end.pid);

    if (activeActivity.value === end.pid) {
      activeActivity.value = null;
    }

    onActivityChanged.next(undefined);
  }

  function isSamePresence(a: Presence, b: Presence): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.kind === b.kind && a.titleName === b.titleName;
  }

  function computePresence(): Presence {
    const music = getLastMusicSession();
    if (music?.isPlaying) {
      return {
        kind: ActivityPresenceKind.LISTEN,
        titleName: `${music.title} - ${music.author}`,
      };
    }

    const game = getLastGameSession();
    if (game) {
      return {
        kind: ActivityPresenceKind.GAME,
        titleName: game.name,
      };
    }

    const software = getLastSoftwareSession();
    if (software) {
      return {
        kind: ActivityPresenceKind.SOFTWARE,
        titleName: software.name,
      };
    }

    return null;
  }

  function publishLatestActivity() {
    const next = computePresence();
    const prev = lastPublishedPresence.value;

    if (isSamePresence(prev, next)) {
      return;
    }

    lastPublishedPresence.value = next;

    if (!next) {
      api.userInteraction.RemoveBroadcastPresence();
      return;
    }

    api.userInteraction.BroadcastPresence({
      kind: next.kind,
      titleName: next.titleName,
      startTimestampSeconds: 0n,
    });
  }

  function getLastMusicSession(): IMusicEvent | null {
    const sessionsArray = Array.from(musicSessions.values());
    return sessionsArray.length > 0
      ? sessionsArray[sessionsArray.length - 1]
      : null;
  }

  function getLastGameSession(): ProcessPlaying | null {
    const sessionsArray = Array.from(
      gameSessions.values().filter((x) => x.kind === 0)
    );
    return sessionsArray.length > 0
      ? sessionsArray[sessionsArray.length - 1]
      : null;
  }

  function getLastSoftwareSession(): ProcessPlaying | null {
    const sessionsArray = Array.from(
      gameSessions.values().filter((x) => x.kind === 1)
    );
    return sessionsArray.length > 0
      ? sessionsArray[sessionsArray.length - 1]
      : null;
  }

  return {
    init,
  };
});
