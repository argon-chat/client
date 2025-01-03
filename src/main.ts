import { createApp } from "vue";
import "./assets/index.css";
import App from "./App.vue";
import { createPinia } from "pinia";
import router from "./router";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
import * as Sentry from "@sentry/vue";
import { MotionPlugin } from "@vueuse/motion";
import { registerDirectives } from "./lib/pexDirective"; 

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);
const app = createApp(App);

/*Sentry.init({
  app,
  dsn: "https://27e1482fc59fff31b5a7263805f7ecac@sentry.svck.dev/7",
  integrations: [
    Sentry.browserTracingIntegration({ router }),
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
});
*/
app.use(router);
app.use(pinia);
app.use(MotionPlugin);
registerDirectives(app);
app.mount("#app");
