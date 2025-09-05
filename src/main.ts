import { createApp } from "vue";
import "./assets/index.css";
import App from "./App.vue";
import { createPinia } from "pinia";
import router from "./router";
import { MotionPlugin } from "@vueuse/motion";
import * as Sentry from "@sentry/vue";
import "@/lib/browser";
import { createI18n } from "vue-i18n";
import { locales, type Locale, type LocaleSchema } from "@/locales";
import "vue3-emoji-picker/css";
import "vfonts/Lato.css";
import "vfonts/FiraCode.css";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import pkg from "../package.json";
import tailwindColorMap from "../tailwind-colors.json";
import "vue-advanced-cropper/dist/style.css";
import { createSentryPiniaPlugin } from "@sentry/vue";
import { setLogLevel } from "livekit-client";
import "@/lib/glue/argonChat";
setLogLevel("debug");
if (argon.isArgonHost) {
  native.V8ThreadingInit();
}
window.ui_version = pkg.version;
window.ui_buildtime = pkg.lastBuildTime;
window.ui_fullversion = pkg.fullVersion;
window.ui_branch = pkg.branch;
(window as any).tailwindColorMap = tailwindColorMap;

export const i18n = createI18n<[LocaleSchema], Locale>({
  locale: "en",
  fallbackLocale: "en",
  messages: locales as any,
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
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
  dsn: argon.dsn(),
});
Sentry.setTag("branch", pkg.branch);
Sentry.setTag("version.full", pkg.fullVersion);
Sentry.setTag("version.build.time", pkg.lastBuildTime);
pinia.use(createSentryPiniaPlugin());
app.use(router);
app.use(pinia);
app.use(MotionPlugin);
app.mount("#app");
