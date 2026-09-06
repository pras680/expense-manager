import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Bill Skills',
        short_name: 'Bill Skills',
        description: 'Family expense tracker',
        theme_color: '#ec3013',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // App-shell precaching only — never cache Supabase REST/Edge Function
        // responses, receipts data must always be fetched fresh.
        navigateFallbackDenylist: [/^\/rest\//, /^\/functions\//],
        // pdfUtils is dynamically imported specifically so pdf.js (~130KB
        // gzipped, plus its ~1.2MB worker) only downloads for someone who
        // actually picks a PDF. Workbox's default globPatterns precache
        // every built JS chunk regardless of how it's loaded, which would
        // silently re-download it for every visitor on install and defeat
        // the entire reason it's split out.
        globIgnores: ['**/pdfUtils-*.js']
      }
    })
  ]
})
