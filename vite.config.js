import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  resolve: {
    alias: [
      {
        find: "https://esm.sh/chess.js@1.4.0",
        replacement: "chess.js",
      },
    ],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
