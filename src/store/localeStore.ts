import { MessageSchema } from "@/locales";
import { defineStore } from "pinia";
import { useI18n } from "vue-i18n";

export const useLocale = defineStore("locale", () => {
  const { t } = useI18n<{ message: MessageSchema }>();
  return {
    t,
  };
});
