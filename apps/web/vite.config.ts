import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ProjectBench',
        short_name: 'ProjectBench',
        description: 'Projects, checklists, notes and files — on your phone.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F4F5F7',
        theme_color: '#F4F5F7',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/files\//, /^\/mcp/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Thumbnails seen online stay readable offline. Full files are not kept on the device.
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin, url }) => sameOrigin && /^\/files\/[^/]+\/thumb$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'projectbench-thumbnails',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/mcp': 'http://localhost:8787',
      '/files': 'http://localhost:8787',
    },
  },
  test: {
    environment: 'jsdom',
  },
});
