import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { useApi } from "@/store/system/apiStore";
import { withDeviceProof } from "@/lib/net/deviceProofHeader";
import {
  AuthorizationError,
  NewUserCredentialsInput,
  RegistrationError,
} from "@argon/glue";
import { IonMaybe } from "@argon-chat/ion.webcore";
import { isWeb } from "@/lib/platform";
import * as webAuth from "@/lib/webAuth";
import { dropCurrentDb } from "@/store/db/dexie";
import { clearUserScopedKeys } from "@/lib/userScopedStorage";
import { metrics, enumName, errorKind } from "@/lib/telemetry/metrics";
const { toast } = useToast();

export const useAuthStore = defineStore("auth", () => {
  const user = ref<string | null>(null);
  const _token = ref<string | null>(null);
  const token = computed(() => _token.value);
  const isAuthenticated = ref(false);
  const isRequiredOtp = ref(false);
  const isRequiredFormResetPass = ref(false);

  const delay = (time: number) => {
    return new Promise((res) => {
      setTimeout(res, time);
    });
  };

  const login = async (
    email: string,
    pass: string,
    otp: string | undefined,
    captchaToken: string | undefined
  ): Promise<AuthorizationError | null> => {
    const api = useApi();
    await delay(500);
    // With a device proof, so the session the server mints is tied to this machine's TPM.
    const r = await withDeviceProof(() => api.identityInteraction.Authorize({
      email: email,
      password: pass,
      phone: null,
      otpCode: otp ?? null,
      captchaToken: captchaToken ?? null,
      username: null,
    }));
    metrics.count("auth.login", {
      method: "password",
      result: r.isSuccessAuthorize()
        ? "ok"
        : r.isFailedAuthorize() && r.error === AuthorizationError.REQUIRED_OTP
          ? "otp_required"
          : "failed",
      error: r.isFailedAuthorize() ? enumName(AuthorizationError, r.error) : undefined,
    });
    if (r.isSuccessAuthorize()) logger.success("Success authorization");
    else if (r.isFailedAuthorize()) {
      logger.fail("Failed authorization", r.error);
      await delay(2500);
    }

    if (r.isFailedAuthorize()) {
      if (r.error === AuthorizationError.REQUIRED_OTP) {
        isRequiredOtp.value = true;
        return null;
      }
      // Surface to the caller for inline display in the form (no toast).
      return r.error;
    } else if (r.isSuccessAuthorize()) {
      isRequiredOtp.value = false;
      isAuthenticated.value = true;

      setAuthToken(r.token);
      if (r.refreshToken) setRefreshToken(r.refreshToken);
    }
    return null;
  };
  const register = async (data: NewUserCredentialsInput) => {
    const api = useApi();
    logger.warn(data);
    const r = await withDeviceProof(() => api.identityInteraction.Registration(data));
    metrics.count("auth.register", {
      result: r.isSuccessRegistration() ? "ok" : "failed",
      error: r.isFailedRegistration() ? enumName(RegistrationError, r.error) : undefined,
    });

    if (r.isSuccessRegistration()) {
      isRequiredOtp.value = false;
      isAuthenticated.value = true;
      setAuthToken(r.token);
      if (r.refreshToken) setRefreshToken(r.refreshToken);
      return;
    } else if (r.isFailedRegistration()) {
      switch (r.error) {
        case RegistrationError.EMAIL_ALREADY_REGISTERED:
          toast({
            title: "Email already registered",
            description: "Maybe you need reset password?",
            variant: "destructive",
            duration: 2500,
          });
          return;
        case RegistrationError.USERNAME_ALREADY_TAKEN:
          toast({
            title: "Username already claimed",
            description: "It's time to be creative!",
            variant: "destructive",
            duration: 2500,
          });
          return;
        case RegistrationError.VALIDATION_FAILED:
          toast({
            title: `Validation for ${r.field} failed`,
            description: r.message ?? "",
            variant: "destructive",
            duration: 2500,
          });
          return;
      }

      toast({
        title: `${r.error}`,
        variant: "destructive",
        duration: 2500,
      });
    }
  };

  const getRefreshToken = (): string | null => {
    return localStorage.getItem("rft");
  };

  const setRefreshToken = (refreshToken: string) => {
    return localStorage.setItem("rft", refreshToken);
  };

  /**
   * Hold the access token, and on the web hold it only in memory.
   *
   * <p>This is what `webAuth`'s header comment has said all along — "it belongs in memory and in the
   * `Authorization` header" — and what the code did not do: the token was written to `localStorage`
   * on every build. On the web that copy was never read back. `restoreSession` hands the web build
   * to `restoreWebSession`, which mints a fresh token from the session cookie and ignores storage;
   * `migrateLegacySessionIfNeeded` returns early on web by its own admission that this key holds the
   * OAuth token; and `adoptCurrentSession` is reached only from the desktop password form and QR
   * pairing, neither of which the browser build has. It sat there readable by any script on the
   * page, for nothing.</p>
   *
   * <p>The desktop keeps the write. There the token survives a restart and there is no cookie to
   * mint a new one from, so storage is doing real work rather than leaving a spare key out.</p>
   *
   * <p>What this does not do is make a stolen page safe: script running on the origin can still read
   * `_token` out of the store, and the token is good for as long as `Jwt:AccessTokenLifetime` says.
   * It removes the copy that outlives the tab, which is the half an attacker can take away with
   * them.</p>
   */
  const setAuthToken = (t: string) => {
    if (!isWeb) localStorage.setItem("token", t);
    _token.value = t;
  };

  /**
   * Mint a fresh access token from the browser's session cookie.
   *
   * The same call the desktop build makes, with the same meaning — only the credential differs. The
   * desktop passes a refresh token it holds; a tab passes nothing, because its refresh token is in a
   * cookie it is not allowed to read, and the API takes it from there. Hence the empty arguments:
   * they are not placeholders, there is genuinely nothing for the page to send.
   *
   * Returns null for every kind of no, but does not treat them alike. Only an explicit refusal —
   * the session was revoked, or its cookie has lapsed — forgets the local marker, and forgetting it
   * is what lets a waking tab tell "renew this later" from "there is nothing to renew". A request
   * that never got an answer, or an account under a lockdown, leaves the marker alone: neither says
   * the session is over, and destroying it on a bad minute is how one turns into a forced sign-in.
   */
  const refreshWebToken = async (): Promise<string | null> => {
    try {
      const result = await useApi().identityInteraction.GetMyAuthorization("", null);

      if (result.isBadAuthStatus()) {
        logger.warn("[web-auth] the session was refused; it has to start again at sign-in", result);
        metrics.count("auth.token.refresh", { result: "refused" });
        webAuth.forgetSession();
        return null;
      }

      if (!result.isGoodAuthStatus()) {
        // Locked accounts and rejected clients answer here. Both are handled where they can be
        // shown to the user; neither is this function's to act on beyond declining to mint.
        logger.warn("[web-auth] the API would not renew this session", result);
        metrics.count("auth.token.refresh", { result: "declined" });
        return null;
      }

      setAuthToken(result.token);
      metrics.count("auth.token.refresh", { result: "ok" });
      return result.token;
    } catch (e) {
      logger.warn("[web-auth] could not renew the session", e);
      metrics.count("auth.token.refresh", { result: "failed", error: errorKind(e) });
      return null;
    }
  };

  /**
   * Adopt (or fail to adopt) the browser build's session.
   *
   * Two ways in and they are not interchangeable. A redirect landing right now carries an
   * authorization code, which is spent once and turned into a session. Any other load has no code
   * and no token in hand — what it may have is the cookie the API set last time, which is invisible
   * from here, so the only way to find out is to ask.
   *
   * Everything downstream still reads `token`, so once it is set the two builds are
   * indistinguishable from here on.
   */
  const restoreWebSession = async (): Promise<void> => {
    // Builds before the token stopped being persisted left one behind, and it outlives every session
    // it belonged to because nothing on this path ever reads the key again. Cleared on the way in
    // rather than left for the next sign-out, which a browser that is simply closed never reaches.
    localStorage.removeItem("token");

    const method = webAuth.isCallback() ? "callback" : webAuth.hasSession() ? "cookie" : "none";
    const token =
      method === "callback"
        ? await webAuth.completeSignIn(useApi().apiEndpoint)
        : method === "cookie"
          ? await refreshWebToken()
          : null;

    // The callback is the tail of a sign-in, so it is counted as one; the cookie path is a restore.
    if (method === "callback") metrics.count("auth.login", { method: "web", result: token ? "ok" : "failed" });
    else metrics.count("auth.session.restore", { method, result: token ? "ok" : "none" });

    if (!token) {
      _token.value = null;
      isAuthenticated.value = false;
      localStorage.removeItem("token");
      return;
    }

    setAuthToken(token);
    isAuthenticated.value = true;
  };

  /**
   * Ends the session, and on the web build takes the cache with it.
   *
   * <p><b>Why only the web build.</b> The desktop holds a registry: every account has its own Dexie
   * database and its own namespaced keys, and signing one out goes through `removeAccount`, which
   * drops both. A tab has no registry — one database, one set of keys, shared by whoever signs in —
   * so leaving them behind hands the next account the last one's sidebar. That is how a space the
   * user was never a member of turned up after switching, and then failed to load.</p>
   *
   * <p>Returns a promise so a caller that is about to reload can wait for it: deleting an IndexedDB
   * is a request the browser can abandon when the page goes away, and a half-deleted cache is the
   * one this was meant to remove.</p>
   */
  const logout = async (): Promise<void> => {
    metrics.count("auth.logout");
    // Best-effort: announce intentional offline so others don't see us linger for the disconnect
    // grace window. Fire-and-forget + lazy import to avoid a circular store dependency; if the realtime
    // connection is already gone the server-side grace covers it.
    void (async () => {
      try {
        const { useBus } = await import("@/store/realtime/busStore");
        await useBus().goOffline();
      } catch { /* not connected — grace handles offline */ }
    })();
    // Fire-and-forget for the same reason: the local state below must drop now, and the request
    // exists to write the server-side tombstone, not to gate the user's own sign-out.
    if (isWeb) void webAuth.signOut(useApi().apiEndpoint);
    user.value = null;
    _token.value = null;
    isAuthenticated.value = false;
    localStorage.removeItem("token");

    if (isWeb) {
      clearUserScopedKeys();
      await dropCurrentDb();
    }
  };

  const restoreSession = async (): Promise<void> => {
    if (isWeb) return restoreWebSession();

    const savedToken = localStorage.getItem("token");
    metrics.count("auth.session.restore", { method: "stored", result: savedToken ? "ok" : "none" });
    logger.info(`restored session, ${savedToken}`);
    if (savedToken) {
      _token.value = savedToken as string;
      isAuthenticated.value = true;
    }
  };

  const beginResetPass = async (email: string) => {
    const api = useApi();

    await api.identityInteraction.BeginResetPassword(email);
    metrics.count("auth.password_reset.begin");

    isRequiredFormResetPass.value = true;
  };

  const resetPass = async (
    email: string,
    newPass: string,
    resetCode: string
  ) => {
    const api = useApi();

    const r = await withDeviceProof(() => api.identityInteraction.ResetPassword(
      email,
      resetCode,
      newPass
    ));

    metrics.count("auth.password_reset", {
      result: r.isSuccessAuthorize() ? "ok" : "failed",
      error: r.isFailedAuthorize() ? enumName(AuthorizationError, r.error) : undefined,
    });
    if (r.isSuccessAuthorize()) {
      logger.success("Success reset password");
    } else if (r.isFailedAuthorize()) {
      logger.fail("Failed reset password", r.error);
      await delay(2500);
    }

    if (r.isFailedAuthorize()) {
      switch (r.error) {
        case AuthorizationError.BAD_CREDENTIALS:
          toast({
            title: "Incorrect credentials",
            description: "You have entered incorrect login credentials",
            variant: "destructive",
            duration: 2500,
          });
          break;
        case AuthorizationError.BAD_OTP:
          toast({
            title: "Incorrect otp code",
            description: "You have entered incorrect OTP code",
            variant: "destructive",
            duration: 2500,
          });
          break;
        case AuthorizationError.REQUIRED_OTP:
          isRequiredOtp.value = true;
          return;
        case AuthorizationError.NONE:
          toast({
            title: "Unknown error",
            description: "Maybe internet connection is corrupted",
            variant: "destructive",
            duration: 2500,
          });
          return;
      }
    } else if (r.isSuccessAuthorize()) {
      isRequiredOtp.value = false;
      isRequiredFormResetPass.value = false;
      isAuthenticated.value = true;

      // Through setAuthToken, and not `localStorage.setItem` on its own. The token every request
      // carries is the reactive `_token`, which the bare write never touched — so a reset ended with
      // the session marked authenticated, the token on disk, and nothing on the wire: the very next
      // call was `GetMe` with no Authorization header, and the server answered 500. The refresh
      // token went missing the same way, which is what left a reset session unable to survive a
      // restart. Every other success path here already does both.
      setAuthToken(r.token);
      if (r.refreshToken) setRefreshToken(r.refreshToken);
    }
  };

  return {
    user,
    token,
    isAuthenticated,
    login,
    logout,
    restoreSession,
    register,
    isRequiredOtp,
    isRequiredFormResetPass,
    beginResetPass,
    resetPass,
    getRefreshToken,
    setRefreshToken,
    setAuthToken,
    refreshWebToken,
  };
});
