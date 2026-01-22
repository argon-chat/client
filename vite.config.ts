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
    },
    build: {
      sourcemap: "hidden",
    },
    css: {
      postcss: {
        plugins: [tailwind(), autoprefixer()],
      },
    },
    plugins: [
      vue(),
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
