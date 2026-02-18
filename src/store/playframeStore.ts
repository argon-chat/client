/**
 * PlayFrame Activity Store
 * 
 * Manages PlayFrame game activity state in voice channels.
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
  IceServersConfig,
  RtcSignalMessage,
  RtcPeerState,
} from "@argon/playframe";
import { useUnifiedCall } from "./unifiedCallStore";
import { usePoolStore } from "./poolStore";
import { useMe } from "./meStore";
import { logger } from "@argon/core";
import { v4 as uuidv4 } from "uuid";

// ============================================================================
// Mock Game Registry (будет заменён на API)
// ============================================================================

export interface GameManifest extends GameInfo {
  url: string;
  thumbnail?: string;
  maxPlayers?: number;
  minPlayers?: number;
  permissions: Permission[];
}

// Mock games for development
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
    permissions: ["keyboard", "audio"],
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
// Store
// ============================================================================

export const usePlayFrameActivity = defineStore("playframe-activity", () => {
  const voice = useUnifiedCall();
  const pool = usePoolStore();
  const me = useMe();

  // Current activity state
  const isActive = ref(false);
  const currentGame = ref<GameManifest | null>(null);
  const pendingGame = ref<GameManifest | null>(null);
  const host = shallowRef<PlayFrameHost | null>(null);
  const hostState = ref<HostState>("idle");
  const context = ref<GameContext | null>(null);
  const sessionId = ref<string | null>(null);
  const error = ref<string | null>(null);

  // Participants in the activity
  const participants = ref<EphemeralUser[]>([]);

  // Game picker state
  const isPickerOpen = ref(false);

  // Available games
  const availableGames = computed(() => MOCK_GAMES);

  // Can start activity (must be in voice channel)
  const canStartActivity = computed(() => {
    return voice.isConnected && voice.mode === "channel" && voice.connectedVoiceChannelId;
  });

  /**
   * Open the game picker
   */
  function openPicker() {
    if (!canStartActivity.value) {
      logger.warn("[PlayFrame] Cannot start activity - not in voice channel");
      return;
    }
    isPickerOpen.value = true;
  }

  /**
   * Close the game picker
   */
  function closePicker() {
    isPickerOpen.value = false;
  }

  /**
   * Select a game and show the panel (first phase)
   * The actual host is created when initializeHost is called with the container
   */
  function selectGame(game: GameManifest): void {
    if (!canStartActivity.value) {
      error.value = "Must be in a voice channel to start an activity";
      return;
    }

    logger.log(`[PlayFrame] Selected game: ${game.title}`);
    pendingGame.value = game;
    currentGame.value = game;
    hostState.value = "loading";
    isActive.value = true;
    isPickerOpen.value = false;
  }

  /**
   * Initialize the host with the container (second phase)
   * Called by PlayFramePanel when it mounts
   */
  async function initializeHost(container: HTMLElement): Promise<boolean> {
    const game = pendingGame.value;
    if (!game) {
      logger.warn("[PlayFrame] No pending game to initialize");
      return false;
    }

    if (host.value) {
      logger.warn("[PlayFrame] Host already initialized");
      return true;
    }

    return startActivity(game, container);
  }

  /**
   * Start an activity with the given game
   */
  async function startActivity(game: GameManifest, container: HTMLElement): Promise<boolean> {
    if (!canStartActivity.value) {
      error.value = "Must be in a voice channel to start an activity";
      return false;
    }

    // Only stop if there's an existing host (not just pending state)
    if (host.value) {
      await stopActivity();
    }

    try {
      logger.log(`[PlayFrame] Starting activity: ${game.title}`);

      currentGame.value = game;
      sessionId.value = uuidv4();
      error.value = null;
      isActive.value = true;

      // Build ephemeral user from current user
      const currentUser = me.me;
      if (!currentUser) {
        throw new Error("No current user");
      }

      const ephemeralUser: EphemeralUser = {
        ephemeralId: uuidv4(), // Generate ephemeral ID
        displayName: currentUser.displayName || "Player",
        avatarUrl: currentUser.avatarFileId || null,
        role: "host",
        state: "active",
      };

      // Build ephemeral space from voice channel
      const channelId = voice.connectedVoiceChannelId;
      if (!channelId) {
        throw new Error("No voice channel");
      }

      const channel = await pool.getChannel(channelId);
      const ephemeralSpace: EphemeralSpace = {
        ephemeralId: uuidv4(),
        name: channel?.name || "Game Room",
        type: "voice-channel",
        maxParticipants: 10,
        participantCount: Object.keys(voice.participants).length + 1,
        isPrivate: false,
      };

      // Build session info
      const session: SessionInfo = {
        sessionId: sessionId.value,
        startedAt: Date.now(),
        state: "playing",
      };

      // Get participants from voice channel
      const voiceParticipants = await getParticipants();
      participants.value = voiceParticipants;

      // Resolve game URL to absolute (needed for PlayFrameHost)
      const gameUrl = new URL(game.url, window.location.origin).href;

      // Create PlayFrame host
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
        autoGrantPermissions: game.permissions,
        getParticipants,
        rtcConfig: {
          getIceServers: mockGetIceServers,
          relaySignal: mockRelaySignal,
          onPeerStateChange: handlePeerStateChange,
        },
        devConfig: {
          enabled: import.meta.env.DEV,
          showOverlay: true,
          logMessages: true,
          disableCsp: import.meta.env.DEV, // CSP can block in dev
          disableWatchdog: import.meta.env.DEV, // Disable watchdog in dev for easier debugging
        },
      };

      const newHost = new PlayFrameHost(hostConfig);

      // Setup event listeners
      newHost.on("ready", (ctx) => {
        logger.log("[PlayFrame] Game ready", ctx);
        context.value = ctx;
        hostState.value = "ready";
      });

      newHost.on("pause", ({ reason }) => {
        logger.log("[PlayFrame] Game paused:", reason);
        hostState.value = "paused";
      });

      newHost.on("resume", () => {
        logger.log("[PlayFrame] Game resumed");
        hostState.value = "ready";
      });

      newHost.on("terminate", ({ reason, message }) => {
        logger.log("[PlayFrame] Game terminated:", reason, message);
        stopActivity();
      });

      newHost.on("error", ({ error: err, fatal }) => {
        logger.error("[PlayFrame] Game error:", err, fatal);
        error.value = err.message;
        if (fatal) {
          stopActivity();
        }
      });

      newHost.on("participantJoin", (user) => {
        logger.log("[PlayFrame] Participant joined:", user.displayName);
        participants.value = [...participants.value, user];
      });

      newHost.on("participantLeave", ({ ephemeralId }) => {
        logger.log("[PlayFrame] Participant left:", ephemeralId);
        participants.value = participants.value.filter((p) => p.ephemeralId !== ephemeralId);
      });

      host.value = markRaw(newHost);
      hostState.value = "loading";
      pendingGame.value = null;

      await newHost.start();

      return true;
    } catch (e) {
      logger.error("[PlayFrame] Failed to start activity:", e);
      error.value = e instanceof Error ? e.message : "Failed to start activity";
      await stopActivity();
      return false;
    }
  }

  /**
   * Stop the current activity
   */
  async function stopActivity() {
    logger.log("[PlayFrame] Stopping activity");

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
  }

  /**
   * Pause the current activity
   */
  function pauseActivity() {
    host.value?.pause("user-requested");
  }

  /**
   * Resume the current activity
   */
  function resumeActivity() {
    host.value?.resume();
  }

  /**
   * Get current participants
   */
  async function getParticipants(): Promise<EphemeralUser[]> {
    const result: EphemeralUser[] = [];

    // Add current user
    const currentUser = me.me;
    if (currentUser) {
      result.push({
        ephemeralId: uuidv4(),
        displayName: currentUser.displayName || "You",
        avatarUrl: currentUser.avatarFileId || null,
        role: "host",
        state: "active",
      });
    }

    // Add voice channel participants
    for (const [userId, participant] of Object.entries(voice.participants)) {
      const user = await pool.getUser(userId);
      if (user) {
        result.push({
          ephemeralId: uuidv4(),
          displayName: user.displayName || "Player",
          avatarUrl: user.avatarFileId || null,
          role: "player",
          state: "active",
        });
      }
    }

    return result;
  }

  // ============================================================================
  // Mock WebRTC Functions (будут заменены на настоящие)
  // ============================================================================

  async function mockGetIceServers(): Promise<IceServersConfig> {
    // In production, this would fetch from the server
    return {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
      ttl: 3600,
      issuedAt: Date.now(),
    };
  }

  async function mockRelaySignal(
    from: string,
    to: string,
    signal: RtcSignalMessage
  ): Promise<boolean> {
    // In production, this would send through the signaling server
    logger.log("[PlayFrame] Mock relay signal:", from, "->", to, signal.type);
    return true;
  }

  function handlePeerStateChange(userId: string, state: RtcPeerState) {
    logger.log("[PlayFrame] Peer state change:", userId, state);
  }

  // ============================================================================
  // Cleanup on voice disconnect
  // ============================================================================

  watch(
    () => voice.isConnected,
    (connected) => {
      if (!connected && isActive.value) {
        logger.log("[PlayFrame] Voice disconnected, stopping activity");
        stopActivity();
      }
    }
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
    
    // Computed
    availableGames,
    canStartActivity,
    
    // Actions
    openPicker,
    closePicker,
    selectGame,
    initializeHost,
    startActivity,
    stopActivity,
    pauseActivity,
    resumeActivity,
  };
});
