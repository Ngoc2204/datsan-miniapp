import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const isAdmin = mode === "admin";
  return {
    plugins: [react()],
    base: isAdmin ? "/admin/" : "/",
    envDir: "../..",
    build: {
      outDir: "dist",
      emptyOutDir: !isAdmin,
      target: "esnext",
      cssCodeSplit: false,
      polyfillModulePreload: false,
      rollupOptions: {
        input: isAdmin
          ? resolve(__dirname, "admin/index.html")
          : resolve(__dirname, "index.html"),
        output: {
          entryFileNames: isAdmin ? "admin/assets/[name].module.js" : "assets/[name].module.js",
          chunkFileNames: isAdmin ? "admin/assets/[name].module.js" : "assets/[name].module.js",
          assetFileNames: isAdmin ? "admin/assets/[name][extname]" : "assets/[name][extname]",
        },
      },
    },
  };
});
