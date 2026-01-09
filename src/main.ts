import "vue-advanced-cropper/dist/style.css";
import "vue3-emoji-picker/css";
import "vfonts/Lato.css";
import "vfonts/FiraCode.css";
import "@argon/assets/styles";

import "@argon/glue";
import "@argon/glue/ipc";
import { native } from "@argon/glue/native";

import pkg from "../package.json";
import tailwindColorMap from "../tailwind-colors.json";

import * as Sentry from "@sentry/vue";
import App from "./App.vue";
import router from "./router";

import { createApp } from "vue";
import { createPinia } from "pinia";
import { MotionPlugin } from "@vueuse/motion";
import { createI18n } from "vue-i18n";
import { coreMessages, type SupportedLocale, type CoreLocaleSchema } from "@argon/i18n";
import { createSentryPiniaPlugin } from "@sentry/vue";

window.ui_version = pkg.version;
window.ui_buildtime = pkg.lastBuildTime;
window.ui_fullversion = pkg.fullVersion;
window.ui_branch = pkg.branch;
(window as any).tailwindColorMap = tailwindColorMap;

export const i18n = createI18n<[CoreLocaleSchema], SupportedLocale>({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: coreMessages as any,
  silentTranslationWarn: true,
  missingWarn: false,
  fallbackWarn: false,
  warnHtmlMessage: false,
});
const pinia = createPinia();
const app = createApp(App);
app.use(i18n);
Sentry.init({
  app,
  release: pkg.version,
  integrations: [
    Sentry.browserTracingIntegration({ router }),
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
    Sentry.replayCanvasIntegration(),
    Sentry.feedbackIntegration({
      colorScheme: "dark",
      autoInject: false,
    }),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
  dsn: await native.dsn,
});
Sentry.setTag("branch", pkg.branch);
Sentry.setTag("version.full", pkg.fullVersion);
Sentry.setTag("version.build.time", pkg.lastBuildTime);
pinia.use(createSentryPiniaPlugin());
app.use(router);
app.use(pinia);
app.use(MotionPlugin);
app.mount("#app");
