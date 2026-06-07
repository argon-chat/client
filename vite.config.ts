import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import Icons from "unplugin-icons/vite";
import vueDevTools from "vite-plugin-vue-devtools";
import SvgImporter from "vite-svg-loader";
import pkg from "./package.json";
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const isCI =
    process.env.CI === "true" ||
    process.env.CI === "1" ||
    process.env.GITHUB_ACTIONS === "true" ||
    process.env.GITLAB_CI === "true";

  const commitSha =
    process.env.GITHUB_SHA ??
    process.env.CI_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.BUILD_VCS_NUMBER;

  const releaseName = pkg.version;

  return {
    server: {
      port: 5005,
      https: {
        key: "localhost-key.pem",
        cert: "localhost.pem",
      },
      hmr: {
        host: "localhost",
        protocol: "wss",
        clientPort: 5005,
      },
    },
    build: {
      sourcemap: "hidden",
      rollupOptions: {
        input: {
          // Main app shell.
          main: path.resolve(__dirname, "index.html"),
          // Lean in-game overlay window (offscreen WebGPU renderer only).
          overlay: path.resolve(__dirname, "overlay.html"),
          // Lean screencast-drawing overlay window (offscreen 2D stroke renderer).
          screencastOverlay: path.resolve(__dirname, "screencast-overlay.html"),
        },
      },
    },
    css: {
      postcss: {
        plugins: [tailwind(), autoprefixer()],
      },
    },
    plugins: [
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag.startsWith("psdk-"),
          },
        },
      }),
      Icons({ compiler: "vue3", autoInstall: true }) as any,
      vueDevTools(),
      SvgImporter(),
      sentryVitePlugin({
        url: env.SENTRY_URL,
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        authToken: env.SENTRY_AUTH_TOKEN,

        release: {
          name: releaseName,
          inject: isCI,
          create: isCI,
          finalize: isCI,
          deploy: { env: mode },
        },

        sourcemaps: isCI
          ? {
              filesToDeleteAfterUpload: [
                "./**/*.map",
                ".*/**/public/**/*.map",
                "./dist/**/client/**/*.map",
              ],
            }
          : undefined,
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      __VUE_PROD_DEVTOOLS__: false,
    },
    worker: {
      format: "es",
    },
  };
});
