import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const siteRoot = resolve(import.meta.dirname, "../../site");
const currentPageAssetAliases = {
  "assets/demo.css": "assets/demo-Cq8UkpJK.css",
  "assets/demo.js": "assets/demo-DsvKC27T.js",
  "assets/favicon.svg": "assets/favicon-DwYaNvUc.svg",
  "assets/home.js": "assets/home-DxbzD8H7.js",
  "assets/motion.css": "assets/motion-NaJoQ8b7.css",
  "assets/motion.js": "assets/motion-DXxvGi6b.js",
  "assets/product-icon.png": "assets/product-icon-byrIb689.png",
};

function preserveCurrentPageAssets(): Plugin {
  return {
    name: "preserve-current-page-assets",
    generateBundle(_options, bundle) {
      for (const [source, alias] of Object.entries(currentPageAssetAliases)) {
        const output = bundle[source];
        if (output === undefined) throw new Error(`Missing site asset: ${source}`);
        this.emitFile({
          type: "asset",
          fileName: alias,
          source: output.type === "asset" ? output.source : output.code,
        });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  appType: "mpa",
  base: command === "serve" ? "/" : "/garden-desk/",
  plugins: [react(), preserveCurrentPageAssets()],
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
}));
