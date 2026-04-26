import "vue-advanced-cropper/dist/style.css";
import "vfonts/Lato.css";
import "vfonts/FiraCode.css";
//@ts-ignore
import "@argon/assets/styles";
import "@argon-chat/emojix/style.css";

import "@argon/glue";
import "@argon/glue/ipc";
import { native } from "@argon/glue/native";

import pkg from "../package.json";
import tailwindColorMap from "../tailwind-colors.json";

import * as Sentry from "@sentry/vue";
import App from "./App.vue";
import router from "./router";

import { createApp, type Plugin } from "vue";
import { createPinia } from "pinia";
import { MotionPlugin } from "@vueuse/motion";
import { createI18n } from "vue-i18n";
import { coreMessages, type SupportedLocale, type CoreLocaleSchema } from "@argon/i18n";
import { createSentryPiniaPlugin } from "@sentry/vue";
import { createEmojix, initializeEmojix } from "@argon-chat/emojix";

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
  dsn: "https://9d074ba73b580b47cdcc16adf72f523d@sentry.argon.gl/22",
  integrations: [
    Sentry.browserTracingIntegration({ router }),
    Sentry.replayIntegration({
      maskAllText: false,
      mask: [".privacy-mask"],
      blockAllMedia: true,
      maskAllInputs: true
    }),
    Sentry.captureConsoleIntegration({
      levels: ['error'],
    }),
    Sentry.contextLinesIntegration(),
    Sentry.httpClientIntegration(),
    Sentry.replayCanvasIntegration(),
    Sentry.feedbackIntegration({
      colorScheme: "dark",
      autoInject: false,
    }),
    Sentry.createSentryPiniaPlugin({
      attachPiniaState: true,
      addBreadcrumbs: false,
      actionTransformer: () => null,
      stateTransformer: () => null,
    })
  ],
  tracesSampleRate: 1.0,
  tracePropagationTargets: ["localhost", /^https:\/\/.*\.argon\.gl/],
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
  environment: import.meta.env.MODE,
  release: pkg.version,
  enabled: true,
  normalizeDepth: 10,
  maxBreadcrumbs: 100,
  enableMetrics: true,
  attachStacktrace: true,
  beforeSend(event, hint) {
    if (event.request?.headers) {
      delete event.request.headers['Authorization'];
      delete event.request.headers['Cookie'];
    }
    return event;
  },
  ignoreErrors: [
    /chrome-extension:/,
    /moz-extension:/,
    'NetworkError',
    'Failed to fetch',
    'ResizeObserver loop',
  ],
  ...{ tunnel: "https://api.argon.gl/k" },
});

Sentry.setTag("branch", pkg.branch);
Sentry.setTag("version.full", pkg.fullVersion);
Sentry.setTag("version.build.time", pkg.lastBuildTime);
app.use(router);
app.use(pinia);
app.use(MotionPlugin);
app.use(createEmojix({ registerComponents: true }) as unknown as Plugin);
initializeEmojix();
app.mount("#app");
