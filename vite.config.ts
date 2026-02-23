import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: "app-src",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "app-src/shared"),
      "@platform": path.resolve(__dirname, "app-src/platform"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
