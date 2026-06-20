import { defineStore } from "pinia";
import { logger } from "@argon/core";
import { useOnline } from "@vueuse/core";
import { delay } from "@argon/core";
import { ref } from "vue";
import { useTone } from "@/store/media/toneStore";
import { useAuthStore } from "@/store/auth/authStore";
import { useMe } from "@/store/auth/meStore";
import { usePredictor } from "@/store/media/predictorStore";
import { useIdleStore } from "@/store/ui/idleStore";
import { useActivity } from "@/store/features/activityStore";
import { worklets, initWorklets } from "@/lib/audio/WorkletBase";
import { audio } from "@/lib/audio/AudioManager";
import { usePreference } from "@/store/ui/preferenceStore";
import router from "@/router";
import { useConfigStore } from "@/store/ui/configStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useInstance } from "@/store/system/instanceStore";
import { useAccounts } from "@/store/auth/accountsStore";

// Initialize worklets with audio getter to break circular dependency
initWorklets(() => audio);

export const useAppState = defineStore("app", () => {
  const isOnline = useOnline();
  const isFailedLoad = ref(false);
  const isLoaded = ref(false);
  const isInitializing = ref(false);
  const loadingStep = ref("");
  const loadingProgress = ref(0);
  const totalSteps = ref(0);
  const hasInitError = ref(false);
  const initError = ref("");

  // Cosmetic pause between steps so the progress bar reads as deliberate.
  const STEP_DELAY = 100;

  interface InitStep {
    label: string;
    run: () => void | Promise<void>;
  }

  // Authenticated-user data load — shared by first-run init and post-login flow.
  async function loadProfile(): Promise<boolean> {
    const continueNext = await useMe().init();
    if (!continueNext) {
      router.push({ path: "/blocked.pg" });
      return false; // blocked
    }
    // Finalize a legacy→registry migration now that the user id is known (reloads into the
    // per-account Dexie DB). No-op outside the one-time migration.
    const accounts = useAccounts();
    if (accounts.isMigrating) {
      const me = useMe().me;
      if (me) {
        await accounts.finalizeMigration({
          userId: me.userId,
          displayName: me.displayName,
          avatarFileId: me.avatarFileId ?? null,
        });
        return false; // reloading
      }
    }
    return true;
  }

  async function loadUserData(): Promise<void> {
    await usePoolStore().loadServerDetails();

    const { useNotificationStore } = await import("@/store/data/notificationStore");
    await useNotificationStore().initFromGlobalBadges();

    await useMe().completeInit();
    await useIdleStore().init();
    await useActivity().init();

    const { useGameOverlaySettings } = await import(
      "@/store/features/gameOverlaySettingsStore"
    );
    useGameOverlaySettings().init();
  }

  async function initializeArgonApp(): Promise<boolean> {
    const auth = useAuthStore();
    let blocked = false;

    // Auth-gated steps no-op when signed out; they stay in the list so the
    // progress total is stable and the runner below stays a single flat loop.
    const steps: InitStep[] = [
      {
        label: "Checking network...",
        run: async () => {
          while (!isOnline.value) {
            logger.info("Waiting network online...");
            await delay(1000);
          }
        },
      },
      // Multi-account: project the active account (instance endpoints + token/rft) BEFORE any RPC,
      // Dexie or session restore. Migrates a legacy single-session into the registry on first run.
      {
        label: "Loading accounts...",
        run: () => {
          const accounts = useAccounts();
          accounts.migrateLegacySessionIfNeeded();
          if (!accounts.applyActiveAtBoot()) useInstance(); // no account → official default instance
          void accounts.gcOrphanDbs(); // reap DBs of accounts removed in a previous session
        },
      },
      // Restore the active instance (self-hosted / enterprise) and re-point endpoints BEFORE any
      // RPC, SignalR or session restore touches the network. No-op when an account is active.
      { label: "Resolving instance...", run: () => { useInstance(); } },
      { label: "Initializing audio engine...", run: () => useTone().init() },
      { label: "Restoring session...", run: () => auth.restoreSession() },
      { label: "Loading AI predictor...", run: () => usePredictor().init() },
      {
        label: "Initializing audio worklets...",
        run: async () => {
          await worklets.init();

          const pref = usePreference();
          if (pref.noiseSuppressionMode !== "off") {
            await audio
              .setNoiseSuppressionMode(pref.noiseSuppressionMode)
              .catch(err => logger.warn("Failed to apply noise suppression mode on startup:", err));
          }
          if (pref.inputGateEnabled) {
            audio.setInputGateThreshold(pref.inputGateThreshold);
            await audio
              .setInputGateEnabled(true)
              .catch(err => logger.warn("Failed to apply input gate on startup:", err));
          }
        },
      },
      { label: "Loading configurations...", run: () => useConfigStore().load() },
      { label: "Initializing data store...", run: () => usePoolStore().init() },
      {
        label: "Loading user profile...",
        run: async () => {
          if (!auth.isAuthenticated) return;
          if (!(await loadProfile())) blocked = true;
        },
      },
      {
        label: "Loading spaces and channels...",
        run: async () => {
          if (!auth.isAuthenticated) return;
          await loadUserData();
        },
      },
    ];

    totalSteps.value = steps.length;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      loadingStep.value = step.label;
      loadingProgress.value = i + 1;
      logger.info(step.label);

      await step.run();
      if (blocked) return false;

      await delay(STEP_DELAY);
    }

    loadingStep.value = "Finalizing...";
    loadingProgress.value = steps.length;
    return true;
  }

  async function initApp() {
    logger.info("Begin initialization argon application");
    isInitializing.value = true;
    hasInitError.value = false;
    initError.value = "";

    const MAX_RETRIES = 10;
    const BASE_DELAY = 1000;
    const MAX_DELAY = 30000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const success = await initializeArgonApp();
        isLoaded.value = true;
        isFailedLoad.value = false;
        hasInitError.value = false;
        initError.value = "";
        if (success) router.push({ path: "/master.pg" });
        logger.success("Complete initialization");
        isInitializing.value = false;
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`Init attempt ${attempt + 1} failed: ${msg}`, e);

        if (attempt >= MAX_RETRIES) {
          isFailedLoad.value = true;
          hasInitError.value = true;
          initError.value = msg;
          return;
        }

        const backoff = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
        loadingStep.value = `Retrying in ${Math.round(backoff / 1000)}s...`;
        await delay(backoff);
      }
    }
  }

  /**
   * Post-authentication continuation — quietly loads the just-signed-in user's
   * data and routes into the app. No full-screen loader: the form's own button
   * spinner covers the brief wait and the shell animates the view in. Hard
   * reload is kept only as a last-resort fallback on failure.
   */
  async function continueAfterLogin(): Promise<void> {
    try {
      if (!(await loadProfile())) return; // blocked → already routed to /blocked.pg
      await loadUserData();
      isLoaded.value = true;
      logger.success("Post-login init complete");
      router.push({ path: "/master.pg" });
    } catch (e) {
      logger.error("Post-login init failed, reloading as fallback:", e);
      window.location.reload();
    }
  }

  return {
    initApp,
    continueAfterLogin,
    isFailedLoad,
    isLoaded,
    isInitializing,
    loadingStep,
    loadingProgress,
    totalSteps,
    hasInitError,
    initError,
  };
});
