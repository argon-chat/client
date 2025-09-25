import { ref, computed, watch } from "vue";
import { useAuthStore } from "@/store/authStore";
import { DateOnly } from "@argon-chat/ion.webcore";

export type TabType =
  | "login"
  | "register"
  | "otp-code"
  | "otp-reset"
  | "pass-reset";

export function useAuthForm() {
  const authStore = useAuthStore();

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
  const brithDate = ref("");
  const allowSendMeOptionalEmails = ref(false);
  const agreeTos = ref(false);
  const otpCode = ref("");

  const decomposeDateOfBirth = (): DateOnly => {
    const [dayStr, monthStr, yearStr] = brithDate.value.split("/");
    const day = +dayStr;
    const month = +monthStr;
    const year = +yearStr;

    if (
      !Number.isInteger(day) ||
      !Number.isInteger(month) ||
      !Number.isInteger(year)
    ) {
      throw new Error("Date contains non-numeric values");
    }
    if (year <= 0) {
      throw new Error("Year must be greater than 0");
    }
    if (month < 1 || month > 12) {
      throw new Error("Month must be between 1 and 12");
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    if (day < 1 || day > daysInMonth) {
      throw new Error(
        `Invalid day: ${day} for month ${month} and year ${year}`
      );
    }

    return { day, month, year };
  };

  async function onSubmit() {
    isLoading.value = true;
    try {
      if (isResetPass.value) {
        if (tabValue.value === "otp-reset") {
          await authStore.resetPass(email.value, password.value, otpCode.value);
        } else {
          await authStore.beginResetPass(email.value);
          tabValue.value = "otp-reset";
        }
      } else if (isRegister.value) {
        await authStore.register({
          argreeOptionalEmails: allowSendMeOptionalEmails.value,
          argreeTos: agreeTos.value,
          displayName: displayName.value,
          email: email.value,
          password: password.value,
          username: username.value,
          captchaToken: null,
          birthDate: decomposeDateOfBirth(),
        });
      } else {
        await authStore.login(
          email.value,
          password.value,
          otpCode.value || undefined,
          undefined
        );
        if (authStore.isRequiredOtp) {
          tabValue.value = "otp-code";
        }
      }
      if (authStore.isAuthenticated) {
        window.location.reload();
      }
    } catch (err) {
      console.error("Auth error:", err);
    } finally {
      isLoading.value = false;
    }
  }

  const goToResetPass = () => {
    tabValue.value = "pass-reset";
  };

  const goBackToLogin = () => {
    tabValue.value = "login";
  };

  const goToRegister = () => {
    tabValue.value = "register";
  };

  return {
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
    onSubmit,
    goToResetPass,
    goBackToLogin,
    goToRegister,
  };
}
