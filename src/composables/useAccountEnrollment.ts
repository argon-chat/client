import { createClient, AuthorizationError, RegistrationError, type NewUserCredentialsInput } from "@argon/glue";
import { staticBearerInterceptor, LocaleInterceptor } from "@/store/system/apiStore";
import {
  useInstance,
  DEFAULT_MANIFEST,
  type InstanceManifest,
} from "@/store/system/instanceStore";
import { deriveAccountId, type AccountRecord } from "@/store/auth/accountsStore";

// Enrollment = signing into an account WITHOUT disturbing the currently-live session. Every RPC runs
// against a ONE-OFF client pointed at the target instance, so the global authStore / instance
// overrides are never touched. On success the caller registers the resulting AccountRecord and
// switches into it (reload). Used by the "Add account" modal.

export type AuthorizeOutcome =
  | { kind: "account"; account: AccountRecord }
  | { kind: "otp" }
  | { kind: "error"; error: AuthorizationError };

export type RegisterOutcome =
  | { kind: "account"; account: AccountRecord }
  | { kind: "error"; error: RegistrationError; field?: string | null; message?: string | null };

export function useAccountEnrollment() {
  const instance = useInstance();

  function clientFor(manifest: InstanceManifest, bearer?: string) {
    const interceptors = bearer
      ? [staticBearerInterceptor(bearer), new LocaleInterceptor()]
      : [new LocaleInterceptor()];
    return createClient(manifest.endpoints.api, interceptors);
  }

  /** Resolve which instance an email's domain belongs to, without mutating global instance state. */
  async function resolveTargetInstance(email: string): Promise<{ kind: string; manifest: InstanceManifest }> {
    const r = await instance.resolveByEmail(email);
    if (r.kind === "managed" && r.instanceUrl) {
      const manifest = await instance.fetchManifest(r.instanceUrl);
      return { kind: "managed", manifest };
    }
    return { kind: r.kind, manifest: DEFAULT_MANIFEST };
  }

  /** Self-hosted endpoint → manifest. Throws InstanceError on failure (same as instanceStore). */
  async function fetchManifest(endpoint: string): Promise<InstanceManifest> {
    return instance.fetchManifest(endpoint);
  }

  async function scenarioFor(manifest: InstanceManifest, email: string): Promise<string> {
    const client = clientFor(manifest);
    return client.IdentityInteraction.GetAuthorizationScenarioFor({ email, phone: null, username: null });
  }

  async function buildAccount(
    manifest: InstanceManifest,
    token: string,
    refreshToken: string | null,
  ): Promise<AccountRecord> {
    // The auth result carries no userId — fetch the profile with the new token.
    const client = clientFor(manifest, token);
    const me = await client.UserInteraction.GetMe();
    return {
      id: deriveAccountId(manifest, me.userId),
      userId: me.userId,
      displayName: me.displayName,
      avatarFileId: me.avatarFileId ?? null,
      instanceManifest: manifest,
      instanceKind: manifest.instance.kind,
      refreshToken,
      accessToken: token,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
  }

  async function authorize(
    manifest: InstanceManifest,
    args: { email: string; password: string; otp?: string },
  ): Promise<AuthorizeOutcome> {
    const client = clientFor(manifest);
    const r = await client.IdentityInteraction.Authorize({
      email: args.email,
      password: args.password,
      phone: null,
      otpCode: args.otp ?? null,
      captchaToken: null,
      username: null,
    });
    if (r.isFailedAuthorize()) {
      if (r.error === AuthorizationError.REQUIRED_OTP) return { kind: "otp" };
      return { kind: "error", error: r.error };
    }
    if (r.isSuccessAuthorize()) {
      const account = await buildAccount(manifest, r.token, r.refreshToken ?? null);
      return { kind: "account", account };
    }
    return { kind: "error", error: AuthorizationError.NONE };
  }

  /**
   * Sends the reset code for an account being added, to the instance that account lives on.
   *
   * The reason this exists rather than reusing `authStore.beginResetPass`: that one runs on
   * `useApi()`, which is the *live* session's client. Called while adding an account it would send
   * the code to whichever instance the user is already signed into — the wrong server, and for a
   * self-hosted target, a different one entirely. Everything here goes through a one-off client
   * pointed at the manifest, exactly as `authorize` does.
   */
  async function beginResetPass(manifest: InstanceManifest, email: string): Promise<void> {
    const client = clientFor(manifest);
    await client.IdentityInteraction.BeginResetPassword(email);
  }

  /**
   * Redeems the code and the new password, and signs the account in.
   *
   * Answers the same shape `authorize` does, because it ends in the same place: a reset that works
   * leaves the server having issued a session, and the account is enrolled from it rather than
   * asking the user to type the password they have only just chosen.
   */
  async function resetPass(
    manifest: InstanceManifest,
    args: { email: string; code: string; password: string },
  ): Promise<AuthorizeOutcome> {
    const client = clientFor(manifest);
    const r = await client.IdentityInteraction.ResetPassword(args.email, args.code, args.password);

    if (r.isFailedAuthorize()) {
      if (r.error === AuthorizationError.REQUIRED_OTP) return { kind: "otp" };
      return { kind: "error", error: r.error };
    }
    if (r.isSuccessAuthorize()) {
      const account = await buildAccount(manifest, r.token, r.refreshToken ?? null);
      return { kind: "account", account };
    }
    return { kind: "error", error: AuthorizationError.NONE };
  }

  async function register(manifest: InstanceManifest, data: NewUserCredentialsInput): Promise<RegisterOutcome> {
    const client = clientFor(manifest);
    const r = await client.IdentityInteraction.Registration(data);
    if (r.isFailedRegistration()) {
      return { kind: "error", error: r.error, field: r.field, message: r.message };
    }
    if (r.isSuccessRegistration()) {
      const account = await buildAccount(manifest, r.token, r.refreshToken ?? null);
      return { kind: "account", account };
    }
    return { kind: "error", error: RegistrationError.VALIDATION_FAILED };
  }

  return { resolveTargetInstance, fetchManifest, scenarioFor, authorize, register, beginResetPass, resetPass };
}
