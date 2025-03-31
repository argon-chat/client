import { createApp } from "vue";
import "./assets/index.css";
import App from "./App.vue";
import { createPinia } from "pinia";
import router from "./router";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
import { MotionPlugin } from "@vueuse/motion";
import { registerDirectives } from "./lib/pexDirective";
import * as Sentry from "@sentry/vue";
import "@/lib/browser";
import { createI18n } from "vue-i18n";
import { locales, Locale, LocaleSchema } from "@/locales";

if (argon.isArgonHost) {
  native.V8ThreadingInit();
}

export const i18n = createI18n<[LocaleSchema], Locale>({
  locale: "en",
  fallbackLocale: "en",
  messages: locales,
});

let pinia = createPinia();
pinia.use(piniaPluginPersistedstate);
var app = createApp(App);
app.use(i18n);

Sentry.init({
  app,
  dsn: argon?.dsn() ?? "",
  integrations: [
    Sentry.browserTracingIntegration({ router }),
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false
    }),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
});
app.use(router);
app.use(pinia);
app.use(MotionPlugin);
registerDirectives(app);
app.mount("#app");
