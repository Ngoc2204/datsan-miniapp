import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const isAdmin = mode === "admin";
  return {
    plugins: [react()],
    base: "/",
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
          entryFileNames: isAdmin ? "assets/admin.module.js" : "assets/index.module.js",
          chunkFileNames: isAdmin ? "assets/admin-[name].module.js" : "assets/[name].module.js",
          assetFileNames: isAdmin ? "assets/admin-[name][extname]" : "assets/[name][extname]",
        },
      },
    },
  };
});
