import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: "./",
  envDir: "../..",
  build: {
    outDir: mode === "admin" ? "dist-admin" : "dist",
    target: "esnext",
    cssCodeSplit: false,
    polyfillModulePreload: false,
    rollupOptions: {
      input: mode === "admin"
        ? resolve(__dirname, "admin/index.html")
        : resolve(__dirname, "index.html"),
      output: {
        entryFileNames: mode === "admin" ? "assets/admin.module.js" : "assets/index.module.js",
        chunkFileNames: "assets/[name].module.js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
}));
