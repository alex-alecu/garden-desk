import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const siteRoot = resolve(import.meta.dirname, "../../site");

export default defineConfig({
  appType: "mpa",
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@vault/shared": resolve(import.meta.dirname, "../shared/src/index.ts"),
      react: resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": resolve(import.meta.dirname, "node_modules/react-dom"),
    },
  },
  publicDir: resolve(siteRoot, "public"),
  root: siteRoot,
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  build: {
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    outDir: resolve(siteRoot, "dist"),
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name][extname]",
        chunkFileNames: "assets/[name].js",
        entryFileNames: "assets/[name].js",
      },
      input: {
        home: resolve(siteRoot, "index.html"),
        demo: resolve(siteRoot, "demo/index.html"),
        downloads: resolve(siteRoot, "downloads/index.html"),
        privacy: resolve(siteRoot, "privacy/index.html"),
        terms: resolve(siteRoot, "terms/index.html"),
        security: resolve(siteRoot, "security/index.html"),
        "404": resolve(siteRoot, "404.html"),
      },
    },
  },
});
