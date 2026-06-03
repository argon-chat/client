/**
 * PlayFrame Activity Store
 *
 * Manages PlayFrame game activity state in voice channels: launching (as host,
 * joining player, or spectator), multiplayer presence (broadcast to the channel
 * via LiveKit participant attributes), and the SFU data-channel transport for
 * game messages + WebRTC signaling.
 */

import { defineStore } from "pinia";
import { ref, shallowRef, computed, watch, markRaw } from "vue";
import {
  PlayFrameHost,
  type PlayFrameHostConfig,
  type HostState,
} from "@argon/playframe-host";
import type {
  GameInfo,
  EphemeralUser,
  EphemeralSpace,
  SessionInfo,
  GameContext,
  Permission,
  ParticipantRole,
  IceServersConfig,
  RtcSignalMessage,
  RtcPeerState,
  SessionUpdatePayload,
  SessionLifecycle,
  SessionMode,
  LaunchIntent,
} from "@argon/playframe";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useMe } from "@/store/auth/meStore";
import { cdnUrl } from "@/store/system/fileStorage";
import { logger } from "@argon/core";
import { toast } from "@argon/ui/toast";
import { v4 as uuidv4 } from "uuid";
import type { Room } from "livekit-client";
import {
  createPlayFrameChannel,
  type PlayFrameChannel,
} from "@/lib/playframe/playframeChannel";

// ============================================================================
// Game Registry (mock — будет заменён на API)
// ============================================================================

export interface GameManifest extends GameInfo {
  url: string;
  thumbnail?: string;
  maxPlayers?: number;
  minPlayers?: number;
  permissions: Permission[];
}

const MOCK_GAMES: GameManifest[] = [
  {
    id: "pong",
    version: "1.0.0",
    title: "Pong",
    description: "Classic Pong game",
    developer: "Argon Games",
    url: "/games/pong/index.html",
    thumbnail: "/games/pong/thumbnail.png",
    maxPlayers: 2,
    minPlayers: 1,
    permissions: ["keyboard", "audio", "networking"],
  },
  {
    id: "snake",
    version: "1.0.0",
    title: "Snake",
    description: "Classic Snake game",
    developer: "Argon Games",
    url: "/games/snake/index.html",
    thumbnail: "/games/snake/thumbnail.png",
    maxPlayers: 1,
    minPlayers: 1,
    permissions: ["keyboard"],
  },
];

// ============================================================================
// Presence
// ============================================================================

/** Activity presence broadcast to the channel via a LiveKit participant attribute. */
export interface ActivityPresence {
  hostId: string;
  hostName: string;
  gameId: string;
  gameTitle: string;
  sessionId: string;
  state: SessionLifecycle;
  mode: SessionMode;
  joinable: boolean;
  spectatable: boolean;
  playerCount: number;
  maxPlayers: number;
}

const PRESENCE_ATTR = "pfActivity";

interface PendingLaunch {
  game: GameManifest;
  intent: LaunchIntent;
  sessionId: string;
  role: ParticipantRole;
  /** userId of the activity host (self for `new`, remote for join/spectate) */
  hostId: string;
}

// ============================================================================
// Store
// ============================================================================

export const usePlayFrameActivity = defineStore("playframe-activity", () => {
  const voice = useUnifiedCall();
  const pool = usePoolStore();
  const me = useMe();

  // Current activity state
  const isActive = ref(false);
  const currentGame = ref<GameManifest | null>(null);
  const host = shallowRef<PlayFrameHost | null>(null);
  const channel = shallowRef<PlayFrameChannel | null>(null);
  const hostState = ref<HostState>("idle");
  const context = ref<GameContext | null>(null);
  const sessionId = ref<string | null>(null);
  const error = ref<string | null>(null);

  // My role in the current activity + who hosts it
  const myRole = ref<ParticipantRole | null>(null);
  const myHostId = ref<string | null>(null);
  // Latest lifecycle reported by the game (menu/waiting/playing/gameover)
  const sessionLifecycle = ref<SessionLifecycle | null>(null);

  // Launch awaiting the panel to mount its container
  const pendingLaunch = ref<PendingLaunch | null>(null);

  // Participants in the activity (for the panel strip)
  const participants = ref<EphemeralUser[]>([]);

  // Game picker / popout UI
  const isPickerOpen = ref(false);
  const isPopout = ref(false);

  const availableGames = computed(() => MOCK_GAMES);

  const canStartActivity = computed(() => {
    return voice.isConnected && voice.mode === "channel" && voice.connectedVoiceChannelId;
  });

  // Activities advertised by OTHER participants in the channel (presence attr)
  const channelActivities = computed<ActivityPresence[]>(() => {
    const out: ActivityPresence[] = [];
    for (const p of Object.values(voice.participants)) {
      if (!p.pfActivity) continue;
      try {
        const a = JSON.parse(p.pfActivity) as ActivityPresence;
        a.hostId = a.hostId || p.userId;
        a.hostName = a.hostName || p.displayName;
        out.push(a);
      } catch {
        /* ignore malformed presence */
      }
    }
    return out;
  });

  // Activities you can act on (not the one you're already in)
  const joinableActivities = computed(() =>
    channelActivities.value.filter((a) => a.sessionId !== sessionId.value),
  );

  // ==========================================================================
  // Picker / popout
  // ==========================================================================

  function openPicker() {
    if (!canStartActivity.value) {
      logger.warn("[PlayFrame] Cannot start activity - not in voice channel");
      return;
    }
    isPickerOpen.value = true;
  }

  function closePicker() {
    isPickerOpen.value = false;
  }

  function togglePopout() {
    isPopout.value = !isPopout.value;
  }

  function closePopout() {
    isPopout.value = false;
  }

  // ==========================================================================
  // Launch entry points
  // ==========================================================================

  /** Start a brand-new activity as host (game shows its own Solo/Multiplayer menu). */
  function selectGame(game: GameManifest): void {
    const meUser = me.me;
    if (!canStartActivity.value || !meUser) {
      error.value = "Must be in a voice channel to start an activity";
      return;
    }
    beginLaunch({
      game,
      intent: "new",
      sessionId: uuidv4(),
      role: "host",
      hostId: meUser.userId,
    });
  }

  /** Join an existing multiplayer activity as a player. */
  function joinActivity(presence: ActivityPresence): void {
    const game = MOCK_GAMES.find((g) => g.id === presence.gameId);
    if (!game || !canStartActivity.value) return;
    beginLaunch({
      game,
      intent: "join",
      sessionId: presence.sessionId,
      role: "player",
      hostId: presence.hostId,
    });
  }

  /** Watch an in-progress activity as a spectator (view-only). */
  function spectateActivity(presence: ActivityPresence): void {
    const game = MOCK_GAMES.find((g) => g.id === presence.gameId);
    if (!game || !canStartActivity.value) return;
    beginLaunch({
      game,
      intent: "spectate",
      sessionId: presence.sessionId,
      role: "spectator",
      hostId: presence.hostId,
    });
  }

  /** Phase 1: stage the launch + show the panel; the host mounts when the panel provides a container. */
  function beginLaunch(launch: PendingLaunch): void {
    logger.log(`[PlayFrame] Launch ${launch.intent}: ${launch.game.title}`);
    pendingLaunch.value = launch;
    currentGame.value = launch.game;
    sessionId.value = launch.sessionId;
    myRole.value = launch.role;
    myHostId.value = launch.hostId;
    hostState.value = "loading";
    isActive.value = true;
    isPickerOpen.value = false;
  }

  /** Phase 2: called by PlayFramePanel once its container is in the DOM. */
  async function initializeHost(container: HTMLElement): Promise<boolean> {
    const launch = pendingLaunch.value;
    if (!launch) {
      logger.warn("[PlayFrame] No pending launch to initialize");
      return false;
    }
    if (host.value) return true;
    return startActivity(launch, container);
  }

  // ==========================================================================
  // Host lifecycle
  // ==========================================================================

  async function startActivity(launch: PendingLaunch, container: HTMLElement): Promise<boolean> {
    if (!canStartActivity.value) {
      error.value = "Must be in a voice channel to start an activity";
      return false;
    }
    if (host.value) await stopActivity();

    try {
      const { game, intent, role } = launch;
      currentGame.value = game;
      sessionId.value = launch.sessionId;
      myRole.value = role;
      myHostId.value = launch.hostId;
      error.value = null;
      isActive.value = true;

      const currentUser = me.me;
      if (!currentUser) throw new Error("No current user");

      // Peer id == userId so every client in the room shares one peer namespace.
      const ephemeralUser: EphemeralUser = {
        ephemeralId: currentUser.userId,
        displayName: currentUser.displayName || "Player",
        avatarId: avatarTokenFor(currentUser.avatarFileId),
        role,
        state: "active",
      };

      const channelId = voice.connectedVoiceChannelId;
      if (!channelId) throw new Error("No voice channel");

      const ch = await pool.getChannel(channelId);
      const ephemeralSpace: EphemeralSpace = {
        ephemeralId: launch.sessionId,
        name: ch?.name || "Game Room",
        type: "voice-channel",
        maxParticipants: 10,
        participantCount: Object.keys(voice.participants).length + 1,
        isPrivate: false,
      };

      const session: SessionInfo = {
        sessionId: launch.sessionId,
        startedAt: Date.now(),
        state: "playing",
      };

      participants.value = await getParticipants();

      const gameUrl = new URL(game.url, window.location.origin).href;

      const hostConfig: PlayFrameHostConfig = {
        gameUrl,
        container,
        game: {
          id: game.id,
          version: game.version,
          title: game.title,
          description: game.description,
          developer: game.developer,
        },
        user: ephemeralUser,
        space: ephemeralSpace,
        session,
        launch: { intent, sessionId: launch.sessionId },
        autoGrantPermissions: game.permissions,
        getParticipants,
        resolveAvatar,
        rtcConfig: {
          getIceServers,
          relaySignal,
          onPeerStateChange: handlePeerStateChange,
        },
        messaging: {
          send: (from, to, data, reliable) =>
            channel.value?.sendGameMessage(from, to, data, reliable),
        },
        onSessionUpdate: handleSessionUpdate,
        onRoleChange: (r) => {
          myRole.value = r;
        },
        devConfig: {
          enabled: import.meta.env.DEV,
          showOverlay: true,
          logMessages: true,
          disableCsp: import.meta.env.DEV,
          disableWatchdog: import.meta.env.DEV,
        },
      };

      const newHost = new PlayFrameHost(hostConfig);

      // SFU data-channel transport (game messages + WebRTC signaling).
      const lkRoom = voice.room as Room | null;
      if (lkRoom) {
        channel.value = createPlayFrameChannel(lkRoom, {
          onSignal: (from, signal) => newHost.relaySignalToGame(from, signal),
          onGameMessage: (from, data) => newHost.deliverMessage(from, data),
        });
      } else {
        logger.warn("[PlayFrame] No LiveKit room - multiplayer disabled");
      }

      newHost.on("ready", (ctx) => {
        context.value = ctx;
        hostState.value = "ready";
      });
      newHost.on("pause", () => (hostState.value = "paused"));
      newHost.on("resume", () => (hostState.value = "ready"));
      newHost.on("terminate", ({ reason, message }) => {
        logger.log("[PlayFrame] Game terminated:", reason, message);
        stopActivity();
      });
      newHost.on("error", ({ error: err, fatal }) => {
        logger.error("[PlayFrame] Game error:", err, fatal);
        error.value = err.message;
        if (fatal) stopActivity();
      });
      newHost.on("participantJoin", (user) => {
        participants.value = [...participants.value, user];
      });
      newHost.on("participantLeave", ({ ephemeralId }) => {
        participants.value = participants.value.filter((p) => p.ephemeralId !== ephemeralId);
      });

      host.value = markRaw(newHost);
      hostState.value = "loading";
      pendingLaunch.value = null;

      await newHost.start();
      return true;
    } catch (e) {
      logger.error("[PlayFrame] Failed to start activity:", e);
      error.value = e instanceof Error ? e.message : "Failed to start activity";
      await stopActivity();
      return false;
    }
  }

  async function stopActivity() {
    logger.log("[PlayFrame] Stopping activity");

    // Clear my advertised presence (host only) before tearing down transport.
    if (myRole.value === "host") publishPresence(null);

    if (channel.value) {
      channel.value.dispose();
      channel.value = null;
    }

    if (host.value) {
      try {
        await host.value.terminate("host-closed");
      } catch (e) {
        logger.warn("[PlayFrame] Error terminating host:", e);
      }
      host.value = null;
    }

    isActive.value = false;
    currentGame.value = null;
    context.value = null;
    sessionId.value = null;
    hostState.value = "idle";
    participants.value = [];
    error.value = null;
    isPopout.value = false;
    myRole.value = null;
    myHostId.value = null;
    sessionLifecycle.value = null;
    pendingLaunch.value = null;

    // Drop session-scoped avatar tokens/cache
    avatarFileByToken.clear();
    avatarTokenByFile.clear();
    avatarDataCache.clear();
  }

  function pauseActivity() {
    host.value?.pause("user-requested");
  }

  function resumeActivity() {
    host.value?.resume();
  }

  // ==========================================================================
  // Multiplayer session presence + messaging
  // ==========================================================================

  /** Game reported its session status → reflect into channel presence (host only). */
  function handleSessionUpdate(info: SessionUpdatePayload) {
    sessionLifecycle.value = info.state;
    if (myRole.value !== "host") return;

    const cur = currentGame.value;
    const meUser = me.me;
    if (!cur || !meUser || !sessionId.value) return;

    publishPresence({
      hostId: meUser.userId,
      hostName: meUser.displayName || "Player",
      gameId: cur.id,
      gameTitle: cur.title,
      sessionId: sessionId.value,
      state: info.state,
      mode: info.mode,
      joinable: info.joinable,
      spectatable: info.spectatable,
      playerCount: info.playerCount,
      maxPlayers: info.maxPlayers,
    });
  }

  function publishPresence(presence: ActivityPresence | null) {
    const lkRoom = voice.room as Room | null;
    if (!lkRoom) return;
    lkRoom.localParticipant
      .setAttributes({ [PRESENCE_ATTR]: presence ? JSON.stringify(presence) : "" })
      .catch((e) => logger.warn("[PlayFrame] setAttributes failed", e));
  }

  async function getParticipants(): Promise<EphemeralUser[]> {
    const result: EphemeralUser[] = [];
    const currentUser = me.me;
    if (currentUser) {
      result.push({
        ephemeralId: currentUser.userId,
        displayName: currentUser.displayName || "You",
        avatarId: avatarTokenFor(currentUser.avatarFileId),
        role: myRole.value ?? "host",
        state: "active",
      });
    }
    for (const userId of Object.keys(voice.participants)) {
      const user = await pool.getUser(userId);
      if (user) {
        result.push({
          ephemeralId: userId,
          displayName: user.displayName || "Player",
          avatarId: avatarTokenFor(user.avatarFileId),
          role: "player",
          state: "active",
        });
      }
    }
    return result;
  }

  // ==========================================================================
  // Avatars (opaque tokens → data URLs, fetched host-side; games never see CDN)
  // ==========================================================================

  const avatarFileByToken = new Map<string, string>(); // token → real fileId
  const avatarTokenByFile = new Map<string, string>(); // fileId → token
  const avatarDataCache = new Map<string, string>(); // token → data URL

  /** Mint (or reuse) an opaque session token for a real avatar file id. */
  function avatarTokenFor(fileId: string | null | undefined): string | null {
    if (!fileId) return null;
    let token = avatarTokenByFile.get(fileId);
    if (!token) {
      token = uuidv4();
      avatarTokenByFile.set(fileId, token);
      avatarFileByToken.set(token, fileId);
    }
    return token;
  }

  /** Host-side avatar resolver passed to the PlayFrameHost. */
  async function resolveAvatar(token: string): Promise<string | null> {
    const cached = avatarDataCache.get(token);
    if (cached) return cached;
    const fileId = avatarFileByToken.get(token);
    if (!fileId) return null;
    const dataUrl = await imageToDataUrl(cdnUrl(fileId));
    if (dataUrl) avatarDataCache.set(token, dataUrl);
    return dataUrl;
  }

  /**
   * Load an image cross-origin (the CDN serves CORS headers, as the overlay
   * relies on) and re-encode it as a small data URL so we can hand bytes — not
   * a URL — to the sandboxed game.
   */
  function imageToDataUrl(url: string): Promise<string | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const size = 64;
          const c = document.createElement("canvas");
          c.width = size;
          c.height = size;
          const cx = c.getContext("2d");
          if (!cx) return resolve(null);
          cx.drawImage(img, 0, 0, size, size);
          resolve(c.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // ==========================================================================
  // WebRTC (legacy P2P path, still available over the same channel)
  // ==========================================================================

  async function getIceServers(): Promise<IceServersConfig> {
    return {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
      ttl: 3600,
      issuedAt: Date.now(),
    };
  }

  async function relaySignal(from: string, to: string, signal: RtcSignalMessage): Promise<boolean> {
    if (!channel.value) return false;
    return channel.value.relaySignal(from, to, signal);
  }

  function handlePeerStateChange(userId: string, state: RtcPeerState) {
    logger.log("[PlayFrame] Peer state change:", userId, state);
  }

  // ==========================================================================
  // Auto-cleanup / participant leave
  // ==========================================================================

  /** Take over my own game instance after the activity host went away. */
  function promoteToHost() {
    toast({ title: "Host left — back to the menu" });
    myRole.value = "host";
    myHostId.value = me.me?.userId ?? null;
    sessionId.value = uuidv4(); // a fresh session if I start a new game
  }

  // Leaving voice ends the activity.
  watch(
    () => voice.isConnected,
    (connected) => {
      if (!connected && isActive.value) stopActivity();
    },
  );

  // Detect participants leaving the voice room → tell the local game (so it can
  // react: end match, drop to menu, stop streaming). If the activity host left,
  // promote myself first so my game becomes its own host at the menu.
  let prevParticipantIds = Object.keys(voice.participants);
  watch(
    () => Object.keys(voice.participants),
    (cur) => {
      const left = prevParticipantIds.filter((id) => !cur.includes(id));
      prevParticipantIds = cur;
      if (!isActive.value || left.length === 0) return;
      for (const id of left) {
        if (id === myHostId.value && myRole.value !== "host") promoteToHost();
        host.value?.notifyPeerLeft(id);
      }
    },
  );

  // Host stayed in the room but cleared its activity presence → also end for me.
  watch(
    channelActivities,
    (acts) => {
      if (!isActive.value || myRole.value === "host" || !sessionId.value) return;
      if (!acts.some((a) => a.sessionId === sessionId.value)) {
        const old = myHostId.value;
        promoteToHost();
        if (old) host.value?.notifyPeerLeft(old);
      }
    },
    { deep: true },
  );

  return {
    // State
    isActive,
    currentGame,
    host,
    hostState,
    context,
    sessionId,
    error,
    participants,
    isPickerOpen,
    isPopout,
    myRole,
    sessionLifecycle,

    // Computed
    availableGames,
    canStartActivity,
    channelActivities,
    joinableActivities,

    // Actions
    openPicker,
    closePicker,
    selectGame,
    joinActivity,
    spectateActivity,
    initializeHost,
    startActivity,
    stopActivity,
    pauseActivity,
    resumeActivity,
    togglePopout,
    closePopout,
  };
});
