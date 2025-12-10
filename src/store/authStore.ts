import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useToast } from "@/components/ui/toast/use-toast";
import { logger } from "@/lib/logger";
import { useApi } from "./apiStore";
import {
  AuthorizationError,
  NewUserCredentialsInput,
  RegistrationError,
} from "@/lib/glue/argonChat";
import { IonMaybe } from "@argon-chat/ion.webcore";
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
  ) => {
    const api = useApi();
    await delay(500);
    const r = await api.identityInteraction.Authorize({
      email: email,
      password: pass,
      phone: null,
      otpCode: otp ?? null,
      captchaToken: captchaToken ?? null,
      username: null,
    });
    console.log(r);
    if (r.isSuccessAuthorize()) logger.success("Success authorization");
    else if (r.isFailedAuthorize()) {
      logger.fail("Failed authorization", r.error);
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
      isAuthenticated.value = true;

      setAuthToken(r.token);
      if (r.refreshToken) setRefreshToken(r.refreshToken);
    }
  };
  const register = async (data: NewUserCredentialsInput) => {
    const api = useApi();
    logger.warn(data);
    const r = await api.identityInteraction.Registration(data);

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

  const setAuthToken = (t: string) => {
    localStorage.setItem("token", t);
    _token.value = t;
  };

  const logout = () => {
    user.value = null;
    _token.value = null;
    isAuthenticated.value = false;
    localStorage.removeItem("token");
  };

  const restoreSession = async (): Promise<void> => {
    const savedToken = localStorage.getItem("token");
    logger.info(`restored session, ${savedToken}`);
    if (savedToken) {
      _token.value = savedToken as string;
      isAuthenticated.value = true;
    }
  };

  const beginResetPass = async (email: string) => {
    const api = useApi();

    await api.identityInteraction.BeginResetPassword(email);

    isRequiredFormResetPass.value = true;
  };

  const resetPass = async (
    email: string,
    newPass: string,
    resetCode: string
  ) => {
    const api = useApi();

    const r = await api.identityInteraction.ResetPassword(
      email,
      resetCode,
      newPass
    );

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
      localStorage.setItem("token", r.token);
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
  };
});
