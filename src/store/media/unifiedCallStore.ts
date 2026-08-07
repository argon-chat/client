import { defineStore } from "pinia";
import { persistedValue } from "@argon/storage";
import { createCallManager, type CallManagerConfig } from "@argon/calls";

import { audio } from "@/lib/audio/AudioManager";
import { ensureMediaPermission } from "@/lib/mediaPermissions";
import { useApi } from "@/store/system/apiStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useTone } from "@/store/media/toneStore";
import { useMe } from "@/store/auth/meStore";
import { useBus } from "@/store/realtime/busStore";
import { useUserVolumeStore } from "@/store/media/userVolumeStore";
import { useRealtimeStore } from "@/store/realtime/realtimeStore";
import { useSystemStore } from "@/store/system/systemStore";
import { usePexStore } from "@/store/data/permissionStore";
import { usePreference } from "@/store/ui/preferenceStore";
import { useDrawingSession } from "@/store/features/drawingSessionStore";

export type { ScreenShareOpts } from "@argon/calls";

/**
 * Voice and video calls.
 *
 * The implementation lives in @argon/calls; this store exists to bind it to the app's
 * stores and host bridge. Keep it a wiring layer — call behaviour belongs in the
 * package, where it can be tested without pinia.
 */
export const useUnifiedCall = defineStore("unifiedCall", () => {
  const config: CallManagerConfig = {
    audio,
    api: useApi() as unknown as CallManagerConfig["api"],
    pool: usePoolStore() as unknown as CallManagerConfig["pool"],
    tone: useTone(),
    me: useMe(),
    bus: useBus(),
    sys: useSystemStore(),
    userVolume: useUserVolumeStore(),
    realtimeStore: useRealtimeStore() as unknown as CallManagerConfig["realtimeStore"],
    pex: usePexStore(),
    // Both are pinia stores, so reading a property here would snapshot it. The manager
    // needs live values (the adaptive-quality toggle is read on every join), hence the
    // lazy accessors rather than a plain object.
    preference: {
      get adaptiveVideoQuality() { return usePreference().adaptiveVideoQuality; },
      get defaultVideoDevice() { return usePreference().defaultVideoDevice; },
      set defaultVideoDevice(v: string) { usePreference().defaultVideoDevice = v; },
    },
    // Resolved lazily, and deliberately not wrapped in try/catch: the manager already
    // guards these calls and logs what failed, so catching here would swallow the
    // reason and leave a broken drawing session looking like a working one.
    drawing: {
      beginStreamerSession: (sourceId) => useDrawingSession().beginStreamerSession(sourceId),
      endStreamerSession: () => useDrawingSession().endStreamerSession(),
    },

    persistedValue,
    ensureMediaPermission,
    consumeCrashRecovery: async () =>
      !!(await (window as any).argonIpc?.consumeCrashRecovery?.()),
    selectScreenSource: async (sourceId, includeAudio) => {
      const ipc = (window as any).argonIpc;
      if (!ipc) return; // web build: the browser shows its own picker
      await ipc.invoke("HostProc", "setPendingScreenSource", [sourceId, includeAudio]);
    },
  };

  return createCallManager(config);
});
