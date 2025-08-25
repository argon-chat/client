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
    const r = await api.userInteraction.Authorize({
      email: email,
      password: pass,
      otpCode: otp ? IonMaybe.Some(otp) : IonMaybe.None(),
      captchaToken: captchaToken ? IonMaybe.Some(captchaToken) : IonMaybe.None(),
      username: IonMaybe.None()
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

      if (argon.isArgonHost) native.protectedStore.setValue("token", r.token);
      else localStorage.setItem("token", r.token);
    }
  };
  const register = async (data: NewUserCredentialsInput) => {
    const api = useApi();
    logger.warn(data);
    const r = await api.userInteraction.Registration(data);

    if (r.isSuccessRegistration()) {
      isRequiredOtp.value = false;
      isAuthenticated.value = true;
      if (argon.isArgonHost) native.protectedStore.setValue("token", r.token);
      else localStorage.setItem("token", r.token);
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
            description: r.message.unwrapOrDefault() ?? "",
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

  const logout = () => {
    user.value = null;
    _token.value = null;
    isAuthenticated.value = false;
    if (argon.isArgonHost) native.protectedStore.setValue("token", "");
    else localStorage.removeItem("token");
  };

  const restoreSession = async (): Promise<void> => {
    const savedToken = argon.isArgonHost
      ? native.protectedStore.getValue("token")
      : localStorage.getItem("token");
    logger.info(`restored session, ${savedToken}`);
    if (savedToken) {
      _token.value = savedToken as string;
      isAuthenticated.value = true;
    }
  };

  const beginResetPass = async (email: string) => {
    const api = useApi();

    await api.userInteraction.BeginResetPassword(email);

    isRequiredFormResetPass.value = true;
  };

  const resetPass = async (
    email: string,
    newPass: string,
    resetCode: string
  ) => {
    const api = useApi();

    const r = await api.userInteraction.ResetPassword(
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
      if (argon.isArgonHost) native.protectedStore.setValue("token", r.token);
      else localStorage.setItem("token", r.token);
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
  };
});
