/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
