import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // Registro manual em src/pwa.ts (só https/localhost; nunca file:// do Electron)
      injectRegister: false,
      registerType: 'autoUpdate',
      manifest: {
        name: 'OMR Correção',
        short_name: 'OMR',
        description: 'Correção de cartões-resposta com a câmera do celular',
        lang: 'pt-BR',
        start_url: '.',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Navegação SPA, mas nunca interceptar a API
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            // Correções e todo tráfego de API: sempre rede, nunca cache
            urlPattern: ({ url }) => url.pathname.startsWith('/api'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          pdf: ['jspdf', 'html2canvas'],
          'react-pdf': ['@react-pdf/renderer'],
          omr: ['xlsx', 'qrcode'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    cors: true,
    // em dev permite ngrok; em produção use lista explícita via VITE_ALLOWED_HOSTS
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
    },
  },
})
