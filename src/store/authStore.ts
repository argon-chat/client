import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useToast } from "@/components/ui/toast/use-toast";
import { logger } from "@/lib/logger";
import { useApi } from "./apiStore";
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
      Email: email,
      Password: pass,
      OtpCode: otp,
      captchaToken: captchaToken,
    });
    console.log(r);
    if (r.IsSuccess) logger.success("Success authorization");
    else {
      logger.fail("Failed authorization", r.Error);
      await delay(2500);
    }

    if (!r.IsSuccess) {
      switch (r.Error) {
        case "BAD_CREDENTIALS":
          toast({
            title: "Incorrect credentials",
            description: "You have entered incorrect login credentials",
            variant: "destructive",
            duration: 2500,
          });
          break;
        case "BAD_OTP":
          toast({
            title: "Incorrect otp code",
            description: "You have entered incorrect OTP code",
            variant: "destructive",
            duration: 2500,
          });
          break;
        case "REQUIRED_OTP":
          isRequiredOtp.value = true;
          return;
        case "NONE":
          toast({
            title: "Unknown error",
            description: "Maybe internet connection is corrupted",
            variant: "destructive",
            duration: 2500,
          });
          return;
      }
    } else {
      isRequiredOtp.value = false;
      isAuthenticated.value = true;

      if (argon.isArgonHost) native.protectedStore.setValue("token", r.Value);
      else localStorage.setItem("token", r.Value);
    }
  };
  const register = async (data: INewUserCredentialsInput) => {
    const api = useApi();
    logger.warn(data);
    const r = await api.userInteraction.Registration(data);

    if (r.IsSuccess) {
      isRequiredOtp.value = false;
      isAuthenticated.value = true;
      if (argon.isArgonHost) native.protectedStore.setValue("token", r.Value);
      else localStorage.setItem("token", r.Value);
      return;
    }
    switch (r.Error.Code) {
      case "EMAIL_ALREADY_REGISTERED":
        toast({
          title: "Email already registered",
          description: "Maybe you need reset password?",
          variant: "destructive",
          duration: 2500,
        });
        return;
      case "USERNAME_ALREADY_TAKEN":
        toast({
          title: "Username already claimed",
          description: "It's time to be creative!",
          variant: "destructive",
          duration: 2500,
        });
        return;
      case "VALIDATION_FAILED":
        toast({
          title: `Validation for ${r.Error.Field} failed`,
          description: r.Error.Message,
          variant: "destructive",
          duration: 2500,
        });
        return;
    }

    toast({
      title: `${r.Error}`,
      variant: "destructive",
      duration: 2500,
    });
  };

  const logout = () => {
    user.value = null;
    _token.value = null;
    isAuthenticated.value = false;
    if (argon.isArgonHost) 
      native.protectedStore.setValue("token", "");
    else 
      localStorage.removeItem("token");
  };

  const restoreSession = async (): Promise<void> => {
    const savedToken = argon.isArgonHost ? native.protectedStore.getValue("token") : localStorage.getItem("token");
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

    const r = await api.userInteraction.ResetPassword({
      Email: email,
      newPassword: newPass,
      otpCode: resetCode,
    });

    if (r.IsSuccess) logger.success("Success reset password");
    else {
      logger.fail("Failed reset password", r.Error);
      await delay(2500);
    }

    if (!r.IsSuccess) {
      switch (r.Error) {
        case "BAD_CREDENTIALS":
          toast({
            title: "Incorrect credentials",
            description: "You have entered incorrect login credentials",
            variant: "destructive",
            duration: 2500,
          });
          break;
        case "BAD_OTP":
          toast({
            title: "Incorrect otp code",
            description: "You have entered incorrect OTP code",
            variant: "destructive",
            duration: 2500,
          });
          break;
        case "REQUIRED_OTP":
          isRequiredOtp.value = true;
          return;
        case "NONE":
          toast({
            title: "Unknown error",
            description: "Maybe internet connection is corrupted",
            variant: "destructive",
            duration: 2500,
          });
          return;
      }
    } else {
      isRequiredOtp.value = false;
      isRequiredFormResetPass.value = false;
      isAuthenticated.value = true;
      if (argon.isArgonHost) native.protectedStore.setValue("token", r.Value);
      else localStorage.setItem("token", r.Value);
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
