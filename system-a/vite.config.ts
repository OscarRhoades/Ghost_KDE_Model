import { defineConfig } from "vite";

// Relative asset paths so the built viewer works from any folder or host.
export default defineConfig({
  base: "./",
  build: { chunkSizeWarningLimit: 1000 },
});
