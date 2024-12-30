import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path, { join } from 'path';
import tailwind from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import Icons from 'unplugin-icons/vite'
import { sentryVitePlugin } from "@sentry/vite-plugin";
import cert from '@vitejs/plugin-basic-ssl'
export default defineConfig({
  server: {
    port: 5005
  },

  css: {
    postcss: {
      plugins: [tailwind(), autoprefixer()],
    },
  },
  plugins: [
    cert(),
    vue(),
    Icons({ compiler: 'vue3', autoInstall: true }) as any,
    sentryVitePlugin({
      org: "argon",
      project: "argon-client",
      url: "https://sentry.svck.dev/",
      authToken: "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",
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      ':glue': path.resolve(__dirname, './glue/wwwroot/_framework'),
    },
  },
})