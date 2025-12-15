import { defineStore } from "pinia";
import { useApi } from "./apiStore";
import { ref } from "vue";
import { logger } from "@/lib/logger";
import { interval, Subject } from "rxjs";
import { debounceTime, switchMap } from "rxjs/operators";
import { ActivityPresenceKind } from "@/lib/glue/argonChat";
import { AudioPlaying, ProcessEnd, ProcessPlaying } from "@/lib/glue/argon.ipc";
import { native } from "@/lib/glue/nativeGlue";

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

  const debouncedActivitySubject = onActivityChanged.pipe(
    debounceTime(1000),
    switchMap((lastEvent) => {
      return [lastEvent];
    }),
  );

  async function init() {
    if (!argon.isArgonHost) return;
    const populatePinnedFn = argon.on<ProcessPlaying>("ProcessPlaying", (x) => {
      onActivityDetected(x)
    })
    if (!await native.hostProc.onGameActivityDetected(populatePinnedFn))
      logger.error("failed to bind activity manager 1");
    const terminatedPinnedFn = argon.on<ProcessEnd>("ProcessEnd", (x) => {
      onActivityTerminated(x)
    })
    if (!await native.hostProc.onGameActivityTerminated(terminatedPinnedFn))
      logger.error("failed to bind activity manager 2");
    const onMusicPlay_pin = argon.on<AudioPlaying>("AudioPlaying", (x) => {
      onMusicPlay(x)
    })
    if (!await native.hostProc.onMusicSessionPlayStateChanged(onMusicPlay_pin))
      logger.error("failed to bind activity manager 4");

    debouncedActivitySubject.subscribe(publishLatestActivity);
    interval(2 * 60 * 1000)
      .pipe(
        switchMap(() => {

          return Promise.resolve(publishLatestActivity());
        }),
      )
      .subscribe();
    native.hostProc.listenActivity();
    native.hostProc.listenSessionMusic();
  }
  function onMusicStop(ev: AudioPlaying) {
    const audioEntity = ev;
    musicSessions.set(audioEntity.sessionId, {
      author: audioEntity.author,
      isPlaying: false,
      title: audioEntity.titleName,
    });
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
    const pid = end.pid;
    logger.info("onActivityTerminated", pid);
    if (activeActivity.value === pid) {
      api.userInteraction.RemoveBroadcastPresence();
      activeActivity.value = null;
    }
    gameSessions.delete(pid);
    onActivityChanged.next(0);
  }

  function publishLatestActivity() {
    const latestMusic = getLastMusicSession();
    const latestGame = getLastGameSession();
    const lastSoftware = getLastSoftwareSession();

    logger.info("publishLatestActivity, ", latestGame, latestMusic);

    if (latestMusic?.isPlaying) {
      api.userInteraction.BroadcastPresence({
        kind: ActivityPresenceKind.LISTEN,
        startTimestampSeconds: 0n,
        titleName: `${latestMusic.title} - ${latestMusic.author}`,
      });
    } else if (latestGame) {
      api.userInteraction.BroadcastPresence({
        kind: ActivityPresenceKind.GAME,
        startTimestampSeconds: 0n,
        titleName: latestGame.name,
      });
    } else if (lastSoftware) {
      api.userInteraction.BroadcastPresence({
        kind: ActivityPresenceKind.SOFTWARE,
        startTimestampSeconds: 0n,
        titleName: lastSoftware.name,
      });
    } else api.userInteraction.RemoveBroadcastPresence();
  }

  function getLastMusicSession(): IMusicEvent | null {
    const sessionsArray = Array.from(musicSessions.values());
    return sessionsArray.length > 0
      ? sessionsArray[sessionsArray.length - 1]
      : null;
  }

  function getLastGameSession(): ProcessPlaying | null {
    const sessionsArray = Array.from(
      gameSessions.values().filter((x) => x.kind === 0),
    );
    return sessionsArray.length > 0
      ? sessionsArray[sessionsArray.length - 1]
      : null;
  }

  function getLastSoftwareSession(): ProcessPlaying | null {
    const sessionsArray = Array.from(
      gameSessions.values().filter((x) => x.kind === 1),
    );
    return sessionsArray.length > 0
      ? sessionsArray[sessionsArray.length - 1]
      : null;
  }

  return {
    init,
  };
});
