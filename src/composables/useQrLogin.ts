import { ref, onUnmounted } from "vue";
import { useApi } from "@/store/system/apiStore";
import { useAuthStore } from "@/store/auth/authStore";
import { useAccounts } from "@/store/auth/accountsStore";
import { LoginRequestError } from "@argon/glue";
import { logger } from "@argon/core";

/** Where the phone's scanner is pointed. See `argonUrlFor` for why it is a URL and not a bare token. */
const LINK_BASE = "https://argon.gl/link";

const POLL_INTERVAL_MS = 2000;

export type QrLoginState = "idle" | "waiting" | "approved" | "rejected" | "error";

/**
 * A URL rather than the token itself.
 *
 * A QR that is also a link degrades gracefully: a phone that does not have Argon installed still
 * gets somewhere useful out of its stock camera app instead of a screenful of hex. The mobile
 * scanner reduces whatever it reads to the last path segment, so both forms are accepted there.
 */
function argonUrlFor(token: string) {
  return `${LINK_BASE}/${token}`;
}

/**
 * The desktop half of QR sign-in: ask for a code, show it, wait for a phone to vouch for it.
 *
 * Both calls are `@AllowAnonymous` because this browser has no credentials yet — that is the whole
 * point of the feature. What it does have is the `ArgonSecure` cookie it already sends on
 * `Authorize`, and the machine id inside it is what the server binds the request to; a code
 * photographed off this screen and polled from somewhere else comes back `DEVICE_MISMATCH`.
 *
 * The poll is a plain interval rather than a long-poll or a socket: the server keeps the request in
 * cache for two minutes and there is nothing to hold open, so a request every couple of seconds for
 * at most that long is cheaper than a connection that has to be kept alive and torn down.
 */
export function useQrLogin() {
  const api = useApi();
  const authStore = useAuthStore();

  const state = ref<QrLoginState>("idle");
  const qrValue = ref("");
  const errorMessage = ref("");

  let timer: number | null = null;
  // Guards against an interval tick firing while the previous one is still in flight — a slow
  // network would otherwise stack polls, and two of them arriving after an approval race for a
  // token the server only hands out once.
  let inFlight = false;
  let currentToken = "";

  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  /** Asks for a code and starts waiting. Safe to call again — it replaces whatever was pending. */
  async function start() {
    stop();
    state.value = "waiting";
    errorMessage.value = "";

    try {
      const result = await api.identityInteraction.CreateLoginRequest();

      if (result.isFailedCreateLoginRequest()) {
        fail(result.error);
        return;
      }

      if (!result.isSuccessCreateLoginRequest()) return;

      currentToken = result.ticket.token;
      qrValue.value = argonUrlFor(currentToken);
      timer = window.setInterval(poll, POLL_INTERVAL_MS);
    } catch (e) {
      logger.fail("Failed to create QR login request", e);
      state.value = "error";
      errorMessage.value = "qr_login_unavailable";
    }
  }

  async function poll() {
    if (inFlight || !currentToken) return;
    inFlight = true;

    try {
      const result = await api.identityInteraction.PollLoginRequest(currentToken);

      if (result.isPendingLoginRequest()) return;

      if (result.isApprovedLoginRequest()) {
        stop();
        authStore.setAuthToken(result.token);
        if (result.refreshToken) authStore.setRefreshToken(result.refreshToken);
        authStore.isAuthenticated = true;
        state.value = "approved";
        // The same landing the password path takes (see useAuthForm.onSubmitPrimary): the session has
        // to be registered as an account before the app can open into its per-account storage.
        await useAccounts().adoptCurrentSession();
        return;
      }

      if (result.isRejectedLoginRequest()) {
        stop();
        state.value = "rejected";
        return;
      }

      if (result.isFailedLoginPoll()) {
        // An expired code is the ordinary end of a request nobody scanned, not a failure to report:
        // ask for another one and let the QR redraw itself. Anything else is a real fault.
        if (result.error === LoginRequestError.NOT_FOUND || result.error === LoginRequestError.EXPIRED) {
          void start();
          return;
        }
        stop();
        fail(result.error);
      }
    } catch (e) {
      // A dropped poll is not a dropped request — the server holds it for the full two minutes, so
      // the next tick simply picks up where this one left off.
      logger.warn("QR login poll failed", e);
    } finally {
      inFlight = false;
    }
  }

  function fail(error: LoginRequestError) {
    state.value = "error";
    errorMessage.value =
      error === LoginRequestError.RATE_LIMITED ? "qr_login_rate_limited" : "qr_login_unavailable";
  }

  onUnmounted(stop);

  return { state, qrValue, errorMessage, start, stop };
}
