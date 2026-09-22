/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves the app from /SIH/, so the base must match.
// Pages builds set GITHUB_PAGES=true; local builds/dev stay root-relative.
const isPages = process.env.GITHUB_PAGES === "true";

/**
 * SEC-010: inject a strict Content-Security-Policy into the PRODUCTION build
 * only (dev needs inline HMR scripts and websockets). GitHub Pages cannot set
 * HTTP response headers, so the meta tag is the only delivery channel there.
 * connect-src allows any *.supabase.co project (the URL is build-time env).
 */
function cspPlugin(): Plugin {
  return {
    name: "inject-csp",
    apply: "build",
    enforce: "post",
    transformIndexHtml(html) {
      const csp = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; ");
      return html.replace(
        /<head>/,
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

export default defineConfig({
  base: isPages ? "/SIH/" : "/",
  plugins: [
    react(),
    tailwindcss(),
    cspPlugin(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "SkillSetu — PM-AJAY GIA Skilling Voice Assistant",
        short_name: "SkillSetu",
        description:
          "AI voice assistant for livelihood mapping and NSQF-aligned skilling recommendations for SC communities under the GIA component of PM-AJAY",
        lang: "en-IN",
        dir: "ltr",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "portrait-primary",
        theme_color: "#2b4dc4",
        background_color: "#ffffff",
        categories: ["education", "government", "productivity"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/SIH\//],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Google Fonts: cache-first for stylesheets and font files
            urlPattern: ({ url }) =>
              url.origin === "https://fonts.googleapis.com" ||
              url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, host: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
