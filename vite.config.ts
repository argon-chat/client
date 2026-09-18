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
      // Fail rather than move. The OAuth verifier is stored per origin and the identity server only
      // trusts this application on :5005 — a silent hop to :5006 turns sign-in into an unreadable
      // exchange failure instead of a port that is taken.
      strictPort: true,
      https: {
        key: "localhost-key.pem",
        cert: "localhost.pem",
      },
      hmr: {
        host: "localhost",
        protocol: "wss",
        clientPort: 5005,
      },

      /**
       * A same-origin, same-scheme way to a stand's files, for the pages that cannot take the
       * ordinary one.
       *
       * The api answers `/files/{id}` with a 302 to wherever the object actually is, and on a local
       * stand that is SeaweedFS on plain http. A page served over https will not follow that hop —
       * it comes out as a broken image with no error anybody sees — which is why the admin console,
       * served over http, shows a file that the cosmetics preview page, served over https, cannot.
       *
       * So the dev server fetches it instead: it does the TLS to the api itself (`secure: false`,
       * because the stand's certificate is a local one), follows the redirect where a browser will
       * not, and hands the bytes back on this origin. Dev only — a deployment serves files from a
       * CDN that speaks https and needs none of this.
       */
      proxy: {
        "/files": {
          target: env.VITE_FILES_ORIGIN || "https://localhost:5002",
          changeOrigin: true,
          secure: false,
          followRedirects: true,
        },
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
          // Lean cosmetics preview page, framed by the admin console (postMessage in, picture out).
          cosmeticPreview: path.resolve(__dirname, "cosmetic-preview.html"),
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
