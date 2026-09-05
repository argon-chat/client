import { logger } from "@argon/core";
import { setUser } from "@sentry/vue";
import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useApi } from "@/store/system/apiStore";
import { withDeviceProof } from "@/lib/net/deviceProofHeader";
import { useBus } from "@/store/realtime/busStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import { useUltimaStore } from "@/store/data/ultimaStore";
import { useTheme } from "@/composables/useTheme";
import { metrics, enumName } from "@/lib/telemetry/metrics";
import {
  ArgonUser,
  ArgonUserProfile,
  BadAuthKind,
  LockdownReason,
  LockdownSeverity,
  LockedAuthStatus,
  UserFlag,
  UserStatus,
} from "@argon/glue";
import { useAuthStore } from "@/store/auth/authStore";
import { useAccounts } from "@/store/auth/accountsStore";
import { LEGAL } from "@/legal/generated";
import { isLegalOutdated } from "@/legal/version";
import { runWhenOnline } from "@/lib/net/connectivity";
import { isSessionRejected } from "@/lib/net/authFailure";
import { userScopedKey } from "@/lib/userScopedStorage";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { isWeb } from "@/lib/platform";

export type ExtendedUser = {
  currentStatus: UserStatus;
} & ArgonUser;

export const useMe = defineStore("me", () => {
  const api = useApi();
  const bus = useBus();
  const featureFlags = useFeatureFlags();
  const me = ref(null as ExtendedUser | null);
  const meProfile = ref(null as ArgonUserProfile | null);

  // The account registry keeps its own copy of this identity: it is what the account picker shows
  // for this account once a different one is active, and by then this instance is no longer the one
  // that can resolve the avatar. Kept in step from here so an avatar or name change lands in it too.
  watch(
    () => [me.value?.userId, me.value?.displayName, me.value?.avatarFileId] as const,
    ([userId, displayName, avatarFileId]) => {
      if (!userId) return;
      void useAccounts().syncActiveProfile({
        userId,
        displayName: displayName ?? "",
        avatarFileId: avatarFileId ?? null,
      });
    },
  );

  // Which legal documents the user must (re-)accept, or null if up to date.
  const legalOutdated = ref<{ terms: boolean; privacy: boolean } | null>(null);

  const limitation = ref(null as LockedAuthStatus | null);

  const ultimaStore = useUltimaStore();

  const isPremium = computed(() =>
    ultimaStore.isSubscribed ||
    ((me.value?.flags ?? 0) & UserFlag.PREMIUM) !== 0
  );

  const preferredStatus = useLocalStorage<UserStatus>(
    userScopedKey("preferredStatus"),
    UserStatus.Online,
    { listenToStorageChanges: true, writeDefaults: true }
  );

  // Away shouldn't be persisted - it's only for automatic idle detection
  if (preferredStatus.value === UserStatus.Away) {
    preferredStatus.value = UserStatus.Online;
  }

  const WelcomeCommanderHasReceived = ref(false);

  // Seamless account switch: clear the current user; init() repopulates for the incoming account.
  onSessionReset(() => {
    me.value = null;
    meProfile.value = null;
    legalOutdated.value = null;
    limitation.value = null;
    WelcomeCommanderHasReceived.value = false;
  });

  async function getMe() {
    return await api.userInteraction.GetMe();
  }
  async function getMeProfile(): Promise<ArgonUserProfile> {
    return await api.userInteraction.GetMyProfile();
  }

  async function refreshLegalState(): Promise<void> {
    try {
      const state = await api.userInteraction.GetMyLegalState();
      const terms = isLegalOutdated(state.tosVersion, LEGAL.terms.current);
      const privacy = isLegalOutdated(state.privacyVersion, LEGAL.privacy.current);
      legalOutdated.value = terms || privacy ? { terms, privacy } : null;
    } catch (e) {
      // Fail open: a transient error here must not lock the user out of the app.
      logger.warn("Failed to load legal acceptance state", e);
      legalOutdated.value = null;
    }
  }

  async function acceptLegal(): Promise<void> {
    await api.userInteraction.AcceptLegal({
      tosVersion: LEGAL.terms.current,
      privacyVersion: LEGAL.privacy.current,
    });
    legalOutdated.value = null;
    metrics.count("legal.accepted");
  }

  // For automatic status changes (idle detection) - doesn't touch preferredStatus
  function setTemporaryStatus(status: UserStatus) {
    if (me.value?.currentStatus === status) return;
    if (me.value) me.value.currentStatus = status;
  }

  // For user-initiated status changes - only updates preferredStatus for DND/TouchGrass
  async function changeStatusTo(status: UserStatus) {
    if (me.value?.currentStatus === status) return;
    metrics.count("user.status.changed", { status: enumName(UserStatus, status) });
    // Only persist DoNotDisturb and TouchGrass to preferredStatus
    // Online/Away are managed automatically by idle detection
    if (status === UserStatus.DoNotDisturb || status === UserStatus.TouchGrass) {
      preferredStatus.value = status;
    } else if (preferredStatus.value === UserStatus.DoNotDisturb || preferredStatus.value === UserStatus.TouchGrass) {
      // Coming back from DND/TouchGrass - reset to Online
      preferredStatus.value = UserStatus.Online;
    }
    if (me.value) me.value.currentStatus = status;
  }

  async function completeInit() {
    bus.doListenMyEvents();
  }

  /**
   * Confirm the browser build's session by using it.
   *
   * `GetMyAuthorization` has already run by this point — `restoreWebSession` calls it, from the
   * session cookie, the same way the desktop calls it from its refresh token. What is left is the
   * check that no exchange can make: whether the token that came back is actually accepted for
   * ordinary work. The first authenticated call is that check.
   */
  async function initWebSession(): Promise<boolean> {
    try {
      me.value = { currentStatus: preferredStatus.value, ...(await runWhenOnline(() => getMe())) };
      return true;
    } catch (e) {
      // `runWhenOnline` has already absorbed the case where the connection dropped mid-request. What
      // survives it is either the server's verdict on this session or the server having a bad
      // minute, and only the first is worth destroying credentials over — the second is rethrown so
      // the boot sequence retries it with its own backoff, as it does for every other failed step.
      if (!isSessionRejected(e)) {
        logger.warn("Loading the profile failed; keeping the session and retrying", e);
        throw e;
      }

      logger.warn("Web session was refused by the API, signing out", e);
      metrics.count("auth.session.check", { result: "rejected" });
      // `logout` already ends the session at the API and drops the local marker; calling signOut
      // here as well would only be a second request saying the same thing.
      useAuthStore().logout();
      location.reload();
      return false;
    }
  }

  async function init(): Promise<boolean> {
    const authStore = useAuthStore();

    if (isWeb) {
      if (!(await initWebSession())) return false;
    } else {

      // Token exchange must never run against a server we can't reach: while offline
      // we park instead of hammering, and a connection that drops mid-flight is
      // retried once it's back — it is NOT mistaken for a rejected session below
      // (only a real `isBadAuthStatus()` verdict from the server logs the user out).
      // A device-bound session can only be refreshed with a proof from this machine's TPM, made
      // for this very call; a session that was never bound refreshes as before and the proof, if
      // any, enrols the machine.
      const result = await runWhenOnline(() =>
        withDeviceProof(() =>
          api.identityInteraction.GetMyAuthorization(
            authStore.token!,
            authStore.getRefreshToken()
          )
        )
      );

      logger.info("GetMyAuthorization", result);

      metrics.count("auth.session.check", {
        result: result.isGoodAuthStatus()
          ? "ok"
          : result.isBadAuthStatus()
            ? "rejected"
            : result.isLockedAuthStatus()
              ? "locked"
              : result.isCertificateErrorAuthStatus()
                ? "bad_client"
                : "unknown",
        reason: result.isLockedAuthStatus() ? enumName(LockdownReason, result.lockdownReason) : undefined,
      });

      if (result.isBadAuthStatus()) {
        // The active account's session is no longer valid. Flag it for re-auth (drops its stale token
        // so the next boot lands on login instead of looping) but keep the account + its cached data.
        useAccounts().markActiveNeedsReauth();
        useAuthStore().logout();
        location.reload();
        return false;
      }
      else if (result.isGoodAuthStatus()) {
        useAuthStore().setAuthToken(result.token);
        useAccounts().updateActiveTokens(result.token);
      }
      else if (result.isLockedAuthStatus()) {
        limitation.value = result;
        logger.warn("Detected restriction on account", result);
        return false;
      } else if (result.isCertificateErrorAuthStatus()) {
        limitation.value = new LockedAuthStatus(LockdownReason.BAD_CLIENT, null, false, LockdownSeverity.Low);
        logger.warn("Detected used bad client", result);
        return false;
      }

      me.value = { currentStatus: preferredStatus.value, ...(await getMe()) };
    }

    // Both branches above set it, but only one of them does so where the compiler can see it.
    if (!me.value) return false;

    meProfile.value = await getMeProfile();
    await refreshLegalState();
    logger.info("Received user info ", me.value);
    logger.info("Received user profile ", meProfile.value);
    
    await featureFlags.loadFeatureFlags();
    // Density is feature-flagged — re-apply now that flags are known so a
    // flag-enabled user's saved density takes effect (default stays comfortable).
    try { useTheme().applyAppearanceSettings(); } catch { /* theme not ready */ }
    await ultimaStore.init();
    
    WelcomeCommanderHasReceived.value = true;

    setUser({ id: me.value.userId, username: me.value.username });

    return true;
  }

  const statusClass = (status: UserStatus, useBg = true) => {
    if (useBg)
      return {
        "bg-green-500": status === UserStatus.Online,
        "bg-yellow-500": status === UserStatus.Away,
        "bg-gray-500": status === UserStatus.Offline,
        "bg-red-500": status === UserStatus.DoNotDisturb,
      };

    return {
      "text-green-500": status === UserStatus.Online,
      "text-yellow-500": status === UserStatus.Away,
      "text-gray-500": status === UserStatus.Offline,
      "text-red-500": status === UserStatus.DoNotDisturb,
    };
  };

  return {
    me,
    meProfile,
    legalOutdated,
    acceptLegal,
    refreshLegalState,
    init,
    completeInit,
    WelcomeCommanderHasReceived,
    changeStatusTo,
    setTemporaryStatus,
    statusClass,
    isPremium,
    limitation,
  };
});
