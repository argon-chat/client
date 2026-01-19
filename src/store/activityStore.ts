import { defineStore } from "pinia";
import { useApi } from "./apiStore";
import { ref } from "vue";
import { logger } from "@argon/core";
import { interval, Subject, type Subscription } from "rxjs";
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

enum ProcessKind {
  GAME = 0,
  SOFTWARE = 1,
}

const ACTIVITY_PUBLISH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const ACTIVITY_DEBOUNCE_MS = 1000; // 1 second

export const useActivity = defineStore("activity", () => {
  const api = useApi();
  const activeActivity = ref<number | null>(null);
  const gameSessions = new Map<number, ProcessPlaying>();
  const musicSessions = new Map<string, IMusicEvent>();
  const onActivityChanged = new Subject<void>();
  const lastPublishedPresence = ref<Presence>(null);
  const subscriptions: Subscription[] = [];

  const debouncedActivitySubject = onActivityChanged.pipe(
    debounceTime(ACTIVITY_DEBOUNCE_MS)
  );

  type ActivityHandler = {
    register: () => Promise<boolean>;
    errorMessage: string;
  };

  function setupSubscriptions(): void {
    subscriptions.push(
      debouncedActivitySubject.subscribe(() => publishLatestActivity())
    );

    subscriptions.push(
      interval(ACTIVITY_PUBLISH_INTERVAL_MS)
        .pipe(switchMap(() => Promise.resolve(publishLatestActivity())))
        .subscribe()
    );
  }

  async function init() {
    if (!argon.isArgonHost) return;

    const handlers: ActivityHandler[] = [
      {
        register: () =>
          native.hostProc.onGameActivityDetected(
            argon.on<ProcessPlaying>("ProcessPlaying", onActivityDetected)
          ),
        errorMessage: "Failed to bind game activity detection",
      },
      {
        register: () =>
          native.hostProc.onGameActivityTerminated(
            argon.on<ProcessEnd>("ProcessEnd", onActivityTerminated)
          ),
        errorMessage: "Failed to bind game activity termination",
      },
      {
        register: () =>
          native.hostProc.onMusicSessionPlayStateChanged(
            argon.on<AudioPlaying>("AudioPlaying", onMusicPlay)
          ),
        errorMessage: "Failed to bind music play state",
      },
      {
        register: () =>
          native.hostProc.onMusicSessionStopStateChanged(
            argon.on<AudioPlayingEnd>("AudioPlayingEnd", onMusicStop)
          ),
        errorMessage: "Failed to bind music stop state",
      },
    ];

    for (const handler of handlers) {
      if (!(await handler.register())) {
        logger.error(handler.errorMessage);
      }
    }

    setupSubscriptions();

    native.hostProc.listenActivity();
    native.hostProc.listenSessionMusic();
  }
  function onMusicStop(ev: AudioPlayingEnd) {
    const session = musicSessions.get(ev.sessionId);

    if (!session) return;

    session.isPlaying = false;
    musicSessions.set(ev.sessionId, session);
    onActivityChanged.next();
  }

  function onMusicPlay(ev: AudioPlaying) {
    musicSessions.set(ev.sessionId, {
      author: ev.author,
      isPlaying: true,
      title: ev.titleName,
    });
    onActivityChanged.next();
  }

  function onActivityDetected(proc: ProcessPlaying) {
    logger.info("onActivityDetected", proc);
    gameSessions.set(proc.pid, proc);
    activeActivity.value = proc.pid;
    onActivityChanged.next();
  }

  function onActivityTerminated(end: ProcessEnd) {
    logger.info("onActivityTerminated", end.pid);

    gameSessions.delete(end.pid);

    if (activeActivity.value === end.pid) {
      activeActivity.value = null;
    }

    onActivityChanged.next();
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
    const sessions = Array.from(musicSessions.values());
    return sessions[sessions.length - 1] ?? null;
  }

  function getLastSessionByKind(kind: ProcessKind): ProcessPlaying | null {
    const sessions = Array.from(gameSessions.values()).filter(
      (x) => x.kind === kind
    );
    return sessions[sessions.length - 1] ?? null;
  }

  function getLastGameSession(): ProcessPlaying | null {
    return getLastSessionByKind(ProcessKind.GAME);
  }

  function getLastSoftwareSession(): ProcessPlaying | null {
    return getLastSessionByKind(ProcessKind.SOFTWARE);
  }

  function cleanup() {
    subscriptions.forEach((sub) => sub.unsubscribe());
    subscriptions.length = 0;
    gameSessions.clear();
    musicSessions.clear();
    onActivityChanged.complete();
  }

  return {
    init,
    cleanup,
  };
});
