import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
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
