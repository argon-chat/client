import { defineStore } from "pinia";
import { useApi } from "./apiStore";
import { ref } from "vue";
import { logger } from "@/lib/logger";
import { interval, Subject } from "rxjs";
import { debounceTime, switchMap } from "rxjs/operators";

export interface IMusicEvent {
  title: string;
  author: string;
  isPlaying: boolean;
}

export const useActivity = defineStore("activity", () => {
  const api = useApi();
  const activeActivity = ref(null as null | number);
  const gameSessions: Map<number, IProcessEntity> = new Map();
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
    const populatePinnedFn = native.createPinnedObject(
      onActivityDetected, //useDebounceFn(, 1000)
    );
    if (!argon.onGameActivityDetected(populatePinnedFn))
      logger.error("failed to bind activity manager 1");
    const terminatedPinnedFn = native.createPinnedObject(
      onActivityTerminated, //useDebounceFn(, 1000)
    );
    if (!argon.onGameActivityTerminated(terminatedPinnedFn))
      logger.error("failed to bind activity manager 2");
    const onMusicEnd = native.createPinnedObject(onMusicStop);
    if (!argon.onMusicSessionPlayStateChanged(onMusicEnd))
      logger.error("failed to bind activity manager 4");

    debouncedActivitySubject.subscribe(publishLatestActivity);
    interval(2 * 60 * 1000)
      .pipe(
        switchMap(() => {
          return Promise.resolve(publishLatestActivity());
        }),
      )
      .subscribe();
    argon.listenActivity();
    argon.listenSessionMusic();
  }

  function onMusicStop(sessionId: string, state: boolean, data: string) {
    const audioEntity = JSON.parse(data) as IAudioEntity;
    musicSessions.set(sessionId, {
      author: audioEntity.Author,
      isPlaying: state,
      title: audioEntity.TitleName,
    });
    onActivityChanged.next(0);
  }

  function onActivityDetected(proc: IProcessEntity) {
    logger.info("onActivityDetected", proc);
    gameSessions.set(proc.pid, proc);
    activeActivity.value = proc.pid;
    onActivityChanged.next(0);
  }

  function onActivityTerminated(pid: number) {
    logger.info("onActivityTerminated", pid);
    if (activeActivity.value === pid) {
      api.userInteraction.RemoveBroadcastPresenceAsync();
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
      api.userInteraction.BroadcastPresenceAsync({
        Kind: "LISTEN",
        StartTimestampSeconds: 0,
        TitleName: `${latestMusic.title} - ${latestMusic.author}`,
      });
    } else if (latestGame) {
      api.userInteraction.BroadcastPresenceAsync({
        Kind: "GAME",
        StartTimestampSeconds: 0,
        TitleName: latestGame.name,
      });
    } else if (lastSoftware) {
      api.userInteraction.BroadcastPresenceAsync({
        Kind: "SOFTWARE",
        StartTimestampSeconds: 0,
        TitleName: lastSoftware.name,
      });
    } else api.userInteraction.RemoveBroadcastPresenceAsync();
  }

  function getLastMusicSession(): IMusicEvent | null {
    const sessionsArray = Array.from(musicSessions.values());
    return sessionsArray.length > 0
      ? sessionsArray[sessionsArray.length - 1]
      : null;
  }

  function getLastGameSession(): IProcessEntity | null {
    const sessionsArray = Array.from(
      gameSessions.values().filter((x) => x.kind === 0),
    );
    return sessionsArray.length > 0
      ? sessionsArray[sessionsArray.length - 1]
      : null;
  }

  function getLastSoftwareSession(): IProcessEntity | null {
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
