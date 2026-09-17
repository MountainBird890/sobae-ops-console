import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Sobae Ops Console',
        short_name: 'Ops Console',
        id: '/',
        start_url: '/login',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#020c45',
        icons: [
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // index.html/navigation requests are deliberately excluded from the
        // precache glob and served network-first instead (see runtimeCaching
        // below) — otherwise generateSW's default precache-and-serve would
        // make the app shell effectively cache-first, and a fresh deploy
        // would keep serving the old build. See docs/pwa_development_design_doc.md §2①.
        globPatterns: ['**/*.{js,css,ico,png,svg,webmanifest,woff2}'],
        // vite-plugin-pwa defaults workbox.navigateFallback to 'index.html',
        // which registers its own NavigationRoute ahead of the NetworkFirst
        // rule below and would silently take over every navigation request.
        // Must be explicitly cleared, not just omitted.
        navigateFallback: undefined,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'html-cache' },
          },
          {
            // /api/* is live organization/contract data — never served from
            // cache, per docs/pwa_development_design_doc.md NF-104.
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
})
