import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import Icons from "unplugin-icons/vite";
import vueDevTools from "vite-plugin-vue-devtools";
import SvgImporter from "vite-svg-loader";
import fs from "fs";
export default defineConfig({
  server: {
    port: 5005,
    https: {
      key: "localhost-key.pem",
      cert: "localhost.pem",
    },
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
    {
      name: "version-generator",
      closeBundle() {
        const dir = path.resolve("dist");
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const version = Date.now().toString();
        const filePath = path.join(dir, "tag.json");
        fs.writeFileSync(filePath, JSON.stringify({ version }), "utf8");
        console.log(`✅ Version tag written to ${filePath}`);
      },
    },
    //tailwindColorExporter()
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __VUE_PROD_DEVTOOLS__: true,
  },
  optimizeDeps: {
    //exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
    //include: ['nsfwjs', '@tensorflow/tfjs'],
  },
  worker: {
    format: "es",
  },
});
