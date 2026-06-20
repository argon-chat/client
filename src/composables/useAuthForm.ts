import { ref, computed } from "vue";
import { useAuthStore } from "@/store/auth/authStore";
import { useAccounts, type AccountRecord } from "@/store/auth/accountsStore";
import { useApi } from "@/store/system/apiStore";
import { useInstance, DEFAULT_MANIFEST, type InstanceManifest } from "@/store/system/instanceStore";
import { useAccountEnrollment } from "@/composables/useAccountEnrollment";
import { useLocale } from "@/store/system/localeStore";
import { useToast } from "@argon/ui/toast";
import { AuthorizationError, RegistrationError } from "@argon/glue";
import { DateOnly } from "@argon-chat/ion.webcore";
import { LEGAL } from "@/legal/generated";
import type { DateValue } from "reka-ui";

function describeAuthError(error: AuthorizationError): string {
  switch (error) {
    case AuthorizationError.BAD_CREDENTIALS:
      return "Incorrect email or password";
    case AuthorizationError.BAD_OTP:
      return "Incorrect verification code";
    default:
      return "Couldn't sign you in. Check your connection and try again.";
  }
}

export type TabType =
  | "login"
  | "register"
  | "otp-code"
  | "otp-reset"
  | "pass-reset"
  | "self-hosted";

export type AuthFormMode = "primary" | "enroll";

type Scenario = "pwd" | "otp" | "pwd-otp" | "";

function mapScenario(scenario: string | null | undefined): Scenario {
  if (!scenario) return "";
  if (scenario === "EmailPassword") return "pwd";
  if (scenario === "EmailPasswordOtp") return "pwd-otp";
  if (scenario === "EmailOtp") return "otp";
  return "pwd";
}

/**
 * Drives the login/registration forms. In "primary" mode it signs the user into the live session
 * (AuthPage). In "enroll" mode (the "Add account" modal) it runs the exact same forms but against a
 * one-off client for a target instance, never disturbing the current session — on success it registers
 * the account and switches into it. The form components are mode-agnostic; all branching lives here.
 */
export function useAuthForm(opts: { mode?: AuthFormMode } = {}) {
  const mode = opts.mode ?? "primary";
  const isEnroll = mode === "enroll";

  const authStore = useAuthStore();
  const api = useApi();
  const instance = useInstance();
  const enrollment = useAccountEnrollment();
  const { t } = useLocale();
  const { toast } = useToast();

  const tabValue = ref<TabType>("login");
  const isRegister = computed(() => tabValue.value === "register");
  const isResetPass = computed(() =>
    ["otp-reset", "pass-reset"].includes(tabValue.value)
  );

  const isLoading = ref(false);

  const email = ref("");
  const password = ref("");
  const username = ref("");
  const displayName = ref("");
  const brithDate = ref<DateValue | undefined>();
  const allowSendMeOptionalEmails = ref(false);
  const agreeTos = ref(false);
  const otpCode = ref("");
  const authError = ref("");

  // Enroll mode: the instance the new account is being created on (resolved by email or self-hosted
  // endpoint). Never touches the global instance overrides.
  const enrollManifest = ref<InstanceManifest | null>(null);

  // Instance shown in the form (chip / QR / self-hosted CTA). In enroll mode it reflects the local
  // enrollManifest; in primary mode it follows the global active instance.
  const effectiveOfficial = computed(() =>
    isEnroll
      ? (enrollManifest.value?.instance.kind ?? "official") === "official"
      : instance.isOfficial
  );
  const effectiveBranding = computed(() =>
    isEnroll ? (enrollManifest.value?.branding ?? DEFAULT_MANIFEST.branding) : instance.branding
  );
  // QR sign-in only makes sense for the primary official sign-in (the mobile app links THIS session).
  const showQr = computed(() => !isEnroll && instance.isOfficial);

  const decomposeDateOfBirth = (): DateOnly => {
    if (!brithDate.value) {
      throw new Error("Birth date is required");
    }
    return {
      year: brithDate.value.year,
      month: brithDate.value.month,
      day: brithDate.value.day,
    };
  };

  // Email step: resolve the target instance + check the auth scenario. Branches primary/enroll.
  async function prepareEmailStep(emailVal: string): Promise<Scenario> {
    if (isEnroll) {
      let manifest = enrollManifest.value;
      if (!manifest) {
        const r = await enrollment.resolveTargetInstance(emailVal);
        manifest = r.manifest;
        enrollManifest.value = manifest;
      }
      const scenario = await enrollment.scenarioFor(manifest, emailVal);
      if (!scenario) authError.value = "Account does not exist";
      return mapScenario(scenario);
    }

    // primary: enterprise/SaaS routing re-points the global instance before the scenario check.
    if (instance.isOfficial) {
      const r = await instance.resolveByEmail(emailVal);
      if (r.kind === "managed" && r.instanceUrl) {
        try {
          const m = await instance.fetchManifest(r.instanceUrl);
          await instance.applyInstance(m);
        } catch {
          authError.value = t("self_hosted_err_org_unreachable");
          return "";
        }
      }
    }
    const scenario = await api.identityInteraction.GetAuthorizationScenarioFor({ email: emailVal, phone: null, username: null });
    if (!scenario) authError.value = "Account does not exist";
    return mapScenario(scenario);
  }

  function useOfficial() {
    if (isEnroll) {
      enrollManifest.value = null;
      authError.value = "";
    } else {
      void instance.resetToDefault();
    }
  }

  // SelfHostedForm calls this with a fetched manifest. Primary re-points the global instance; enroll
  // only stashes it locally so the live session is untouched.
  async function applyManifestFromSelfHosted(m: InstanceManifest) {
    if (isEnroll) enrollManifest.value = m;
    else await instance.applyInstance(m);
  }

  function finishEnroll(account: AccountRecord) {
    const res = useAccounts().addAccount(account);
    if (!res.ok) {
      authError.value = account.instanceKind === "official"
        ? t("accounts_cap_official")
        : t("accounts_cap_alt");
      return;
    }
    void useAccounts().switchTo(account.id); // persists + reloads into the new account
  }

  function reportRegisterError(o: { error: RegistrationError; field?: string | null; message?: string | null }) {
    switch (o.error) {
      case RegistrationError.EMAIL_ALREADY_REGISTERED:
        toast({ title: "Email already registered", description: "Maybe you need reset password?", variant: "destructive", duration: 2500 });
        return;
      case RegistrationError.USERNAME_ALREADY_TAKEN:
        toast({ title: "Username already claimed", description: "It's time to be creative!", variant: "destructive", duration: 2500 });
        return;
      case RegistrationError.VALIDATION_FAILED:
        toast({ title: `Validation for ${o.field} failed`, description: o.message ?? "", variant: "destructive", duration: 2500 });
        return;
      default:
        toast({ title: `${o.error}`, variant: "destructive", duration: 2500 });
    }
  }

  function registrationPayload() {
    return {
      argreeOptionalEmails: allowSendMeOptionalEmails.value,
      argreeTos: agreeTos.value,
      displayName: displayName.value,
      email: email.value,
      password: password.value,
      username: username.value,
      captchaToken: null,
      birthDate: decomposeDateOfBirth(),
      tosVersion: LEGAL.terms.current,
      privacyVersion: LEGAL.privacy.current,
    };
  }

  async function onSubmitPrimary() {
    if (isResetPass.value) {
      if (tabValue.value === "otp-reset") {
        await authStore.resetPass(email.value, password.value, otpCode.value);
      } else {
        await authStore.beginResetPass(email.value);
        tabValue.value = "otp-reset";
      }
    } else if (isRegister.value) {
      await authStore.register(registrationPayload());
    } else {
      const error = await authStore.login(email.value, password.value, otpCode.value || undefined, undefined);
      if (authStore.isRequiredOtp) {
        tabValue.value = "otp-code";
      } else if (error !== null) {
        authError.value = describeAuthError(error);
      }
    }
    if (authStore.isAuthenticated) {
      // Adopt the now-live session into the registry (account #1 on a fresh sign-in, or refresh the
      // active account on re-auth) and switch into it (reloads → per-account Dexie DB from the start).
      await useAccounts().adoptCurrentSession();
    }
  }

  async function onSubmitEnroll() {
    if (isResetPass.value) return; // password reset isn't part of adding an account
    const manifest = enrollManifest.value ?? DEFAULT_MANIFEST;

    if (isRegister.value) {
      const outcome = await enrollment.register(manifest, registrationPayload());
      if (outcome.kind === "error") { reportRegisterError(outcome); return; }
      finishEnroll(outcome.account);
      return;
    }

    const outcome = await enrollment.authorize(manifest, {
      email: email.value, password: password.value, otp: otpCode.value || undefined,
    });
    if (outcome.kind === "otp") { tabValue.value = "otp-code"; return; }
    if (outcome.kind === "error") { authError.value = describeAuthError(outcome.error); return; }
    finishEnroll(outcome.account);
  }

  async function onSubmit() {
    isLoading.value = true;
    authError.value = "";
    try {
      if (isEnroll) await onSubmitEnroll();
      else await onSubmitPrimary();
    } catch (err) {
      console.error("Auth error:", err);
    } finally {
      isLoading.value = false;
    }
  }

  const goToResetPass = () => { tabValue.value = "pass-reset"; };
  const goBackToLogin = () => { tabValue.value = "login"; };
  const goToRegister = () => { tabValue.value = "register"; };
  const goToSelfHosted = () => { tabValue.value = "self-hosted"; };

  return {
    mode,
    isEnroll,
    authStore,
    tabValue,
    isRegister,
    isResetPass,
    isLoading,
    email,
    password,
    username,
    displayName,
    allowSendMeOptionalEmails,
    agreeTos,
    otpCode,
    brithDate,
    authError,
    enrollManifest,
    effectiveOfficial,
    effectiveBranding,
    showQr,
    prepareEmailStep,
    useOfficial,
    applyManifestFromSelfHosted,
    onSubmit,
    goToResetPass,
    goBackToLogin,
    goToRegister,
    goToSelfHosted,
  };
}
