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
    Sentry.feedbackIntegration({
      colorScheme: "dark",
      autoInject: false,
    }),
    Sentry.createSentryPiniaPlugin({
      attachPiniaState: false,
      addBreadcrumbs: false,
      actionTransformer: () => null,
      stateTransformer: () => null,
    })
  ],
  tracesSampleRate: import.meta.env.DEV ? 0 : 1.0,
  tracePropagationTargets: ["localhost", /^https:\/\/.*\.argon\.gl/],
  replaysSessionSampleRate: import.meta.env.DEV ? 0 : 1.0,
  replaysOnErrorSampleRate: 1.0,
  environment: import.meta.env.MODE,
  release: pkg.version,
  enabled: true,
  normalizeDepth: 5,
  maxBreadcrumbs: 50,
  attachStacktrace: false,
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

// Argon Console Branding
const argonSvg = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M114.54,88.82c5.35-2.75,9.96-6.72,13.46-11.53c-4.67-3.14-9.86-5.56-15.4-7.09c0.01-24.5-6.29-48.6-18.25-69.73c-7.96,8.45-14.3,18.49-18.62,29.31c-7.66-1.22-15.65-1.06-23.27,0.31C48.13,19.15,41.74,9.02,33.71,0.47C21.76,21.62,15.45,45.7,15.46,70.2c-5.54,1.53-10.73,3.95-15.4,7.09c3.49,4.82,8.1,8.78,13.46,11.53c-3.64,2.85-6.74,6.37-9.14,10.33c5.87,4.32,12.67,7.48,20.05,9.09c19.68,25.4,59.51,25.41,79.2,0c7.38-1.61,14.18-4.78,20.05-9.09C121.28,95.19,118.18,91.68,114.54,88.82z M23.7,68.22c0,0,4.13-2.07,12.4-2.07c8.27,0,19.64,11.37,19.64,11.37s-8.27,6.2-19.64,9.3C32.11,87.91,26.8,77.52,23.7,68.22z M64,98.19c-5.71,0-10.33-4.13-10.33-12.4c1.04-0.35,2.16-0.62,3.3-0.85l3,6.02l1.21-6.61c1.9-0.14,3.84-0.14,5.75,0.01l1.22,6.65l3.01-6.05c1.1,0.23,2.17,0.49,3.18,0.82C74.33,94.05,69.71,98.19,64,98.19z M92.99,86.03c-11.37-3.1-19.63-9.3-19.63-9.3s11.37-11.37,19.63-11.37s12.4,2.07,12.4,2.07C102.29,76.73,96.98,87.12,92.99,86.03z" fill="#3B82F6"/></svg>`)}`;

console.log(
  `%c %c %c ARGON %c v${pkg.version} %c ${pkg.branch} %c`,
  `background: url('${argonSvg}') no-repeat center center / contain; padding: 20px 24px; margin-right: 4px;`,
  `background: transparent; padding: 0;`,
  `background: linear-gradient(135deg, #3B82F6, #8B5CF6); color: #fff; font-size: 18px; font-weight: 900; padding: 8px 16px; border-radius: 6px 0 0 6px; text-shadow: 0 2px 4px rgba(0,0,0,0.3); letter-spacing: 3px;`,
  `background: #1e293b; color: #60A5FA; font-size: 12px; font-weight: 600; padding: 10px 12px; border-right: 1px solid #334155;`,
  `background: #1e293b; color: #A78BFA; font-size: 12px; font-weight: 600; padding: 10px 12px; border-radius: 0 6px 6px 0;`,
  `background: transparent;`
);

console.log(
  `%c✦ Build %c${pkg.lastBuildTime}%c ✦ Environment %c${import.meta.env.MODE}%c ✦`,
  `color: #64748b; font-size: 11px;`,
  `color: #38BDF8; font-size: 11px; font-weight: bold;`,
  `color: #64748b; font-size: 11px;`,
  `color: #34D399; font-size: 11px; font-weight: bold;`,
  `color: #64748b; font-size: 11px;`
);

console.log(
  `%c🔗 https://argon.gl %c— Made with 💙`,
  `color: #60A5FA; font-size: 11px; font-weight: bold;`,
  `color: #94A3B8; font-size: 11px;`
);
