import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

// Duas entradas: `index.html` (site + área do cliente, PWA) e `admin.html` (painel da equipe, sem PWA).
// O servidor só entrega admin.html e assets/admin-* no host do painel.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: false,
      includeAssets: ['favicon.svg', 'brand/logo-*.svg', 'brand/icon-*.png', 'brand/apple-touch-icon.png'],
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/painel/, /^\/admin/, /^\/health/],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/admin.html', '**/assets/admin-*', '**/brand/og-image.png']
      }
    })
  ],
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html') },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'admin' ? 'assets/admin-[hash].js' : 'assets/[name]-[hash].js'),
        chunkFileNames: (chunk) => (chunk.name.startsWith('admin') ? 'assets/admin-[name]-[hash].js' : 'assets/[name]-[hash].js'),
        assetFileNames: (asset) => (asset.names?.some((n) => n.startsWith('admin')) ? 'assets/admin-[name]-[hash][extname]' : 'assets/[name]-[hash][extname]'),
        manualChunks(id) {
          if (id.includes('/src/admin/')) return 'admin-app';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler') || id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run')) return 'vendor';
          return undefined;
        }
      }
    }
  },
  server: { proxy: { '/api': 'http://localhost:8080', '/health': 'http://localhost:8080' } }
});
