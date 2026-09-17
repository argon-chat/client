/**
 * Binding a web session to this browser, where the browser will not do it itself.
 *
 * Chromium reads `Secure-Session-Registration` off the session exchange and runs the whole protocol
 * without being asked. Firefox and Safari ignore it, so this drives the same exchange by hand
 * against the endpoints that take the same values in a body — see `DeviceBoundSessionEndpoints`
 * for why a second pair exists at all (`Sec-` is a forbidden header prefix; `fetch` cannot send
 * those headers, and drops them without saying so).
 *
 * Both legs are two round trips by design: the server issues a challenge, we sign it, and it is
 * spent on use. A captured proof is worth one exchange that has already happened.
 *
 * Failure here is never fatal. A browser that cannot store a key, or a server that declines, leaves
 * the session exactly as it was before any of this — shorter-lived than a bound one, and working.
 */
import { logger } from "@argon/core";
import { deviceKey, publicJwk, signProof } from "@/lib/net/deviceKey";

/**
 * Which binding this browser holds.
 *
 * Not a credential and deliberately not treated as one: presenting it proves nothing, because the
 * refresh it names still has to be signed. It is a name, so it lives where names live.
 */
const SESSION_KEY = "argon.deviceBinding.sessionId";

const REGISTER_PATH = "/auth/web/device/register";
const REFRESH_PATH = "/auth/web/device/refresh";

export const boundSessionId = (): string | null => {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
};

const remember = (id: string) => {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    // A browser refusing storage still has a working session; it just re-registers next time.
  }
};

export const forgetBoundSession = () => {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to forget */
  }
};

/** Both endpoints speak JSON and need the cookies — the session being bound is one of them. */
const post = (apiBase: string, path: string, body: unknown): Promise<Response> =>
  fetch(`${apiBase}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Binds this session to a key that cannot leave the browser.
 *
 * @returns the binding's id, or null when the browser or the server declined — both of which are
 *          ordinary, and neither of which is an error the caller should react to.
 */
export async function bindDevice(apiBase: string): Promise<string | null> {
  try {
    const offered = await post(apiBase, REGISTER_PATH, {});

    // 404 means binding is switched off server-side; 401 that this browser holds no session to
    // bind. Neither is worth a line in the log on every sign-in.
    if (!offered.ok) return null;

    const { challenge } = (await offered.json()) as { challenge?: string };

    if (!challenge) return null;

    const key = await deviceKey();

    if (!key) return null;

    const registered = await post(apiBase, REGISTER_PATH, {
      proof: await signProof(key, challenge, await publicJwk(key)),
    });

    if (!registered.ok) {
      logger.warn("[device-binding] the server refused this device's registration", registered.status);
      return null;
    }

    const config = (await registered.json()) as { session_identifier?: string };

    if (!config.session_identifier) return null;

    remember(config.session_identifier);
    logger.info("[device-binding] this session is bound to a key held by the browser");

    return config.session_identifier;
  } catch (e) {
    logger.warn("[device-binding] could not bind this session", e);
    return null;
  }
}

/**
 * Proves the key again, which is what re-issues the short-lived cookies.
 *
 * @returns whether the binding still stands. False means it is gone for good — expired, or ended
 *          server-side — and the caller should stop asking and fall back to an ordinary refresh.
 */
export async function refreshDeviceBinding(apiBase: string): Promise<boolean> {
  const sessionId = boundSessionId();

  if (!sessionId) return false;

  try {
    const challenged = await post(apiBase, REFRESH_PATH, { sessionId });

    // The protocol's way of saying the binding is over. Stop asking.
    if (challenged.ok) {
      const done = (await challenged.json()) as { continue?: boolean };
      if (done.continue === false) {
        forgetBoundSession();
        return false;
      }
      return true;
    }

    if (challenged.status !== 401) return false;

    const { challenge } = (await challenged.json()) as { challenge?: string };
    const key = await deviceKey();

    if (!challenge || !key) return false;

    // No jwk this time: the server checks against the key it stored, and a key offered here would
    // be the caller nominating what to verify against.
    const proven = await post(apiBase, REFRESH_PATH, {
      sessionId,
      proof: await signProof(key, challenge),
    });

    if (!proven.ok) {
      logger.warn("[device-binding] this device could not prove its key", proven.status);
      return false;
    }

    return true;
  } catch (e) {
    logger.warn("[device-binding] could not refresh the device binding", e);
    return false;
  }
}
