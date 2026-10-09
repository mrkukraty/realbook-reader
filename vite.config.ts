/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered manually from src/app/pwa.ts (skipped inside Tauri)
      includeAssets: ['favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'RealBook Reader',
        short_name: 'RealBook',
        description: 'Local-first ebook reader with realistic page turning. Works offline.',
        theme_color: '#2b1d14',
        background_color: '#2b1d14',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache all built assets, including the pdf.js worker and wasm.
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,ico,woff2,wasm,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'jsdom', globals: true, include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
