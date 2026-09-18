/**
 * Entry point for the cosmetics preview page (cosmetic-preview.html), which the admin console frames
 * to show an operator what a row actually looks like before it is published.
 *
 * Deliberately minimal — no router, no sockets, no auth, no Sentry, no app shell. It mounts the
 * preview host, which draws with the real cosmetic renderers and answers the console over
 * postMessage. Everything it reads is a public file.
 *
 * The storage isolation is the first import and has to stay there: it must be in place before any
 * module reads a persisted appearance value. See `isolatedStorage`.
 */
import "@/cosmetics/preview/isolatedStorage";

import "vfonts/Lato.css";
//@ts-ignore
import "@argon/assets/styles";
import "./styles/reduced-motion.css";

import { createApp } from "vue";
import { createPinia } from "pinia";

import { i18n } from "./lib/i18n";
import CosmeticPreviewHost from "@/cosmetics/preview/CosmeticPreviewHost.vue";

const app = createApp(CosmeticPreviewHost);

// Pinia because the renderers read what is worn through the cosmetics store, and i18n because a
// badge's tooltip is a translation key. Neither fetches anything here: the profile is handed in.
app.use(createPinia());
app.use(i18n);

app.mount("#cosmetic-preview");
