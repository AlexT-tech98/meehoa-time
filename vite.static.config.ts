import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import path from "path";

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  resolve: {
    alias: {
      "@/lib/data-service": path.resolve(__dirname, "./lib/data-service-compat.ts"),
      "@": path.resolve(__dirname, "./"),
    },
  },
  build: {
    outDir: "dist_static",
    emptyOutDir: true,
  },
});
