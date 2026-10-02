import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const bff = 'http://127.0.0.1:8110';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Phòng mạch – bản trình diễn',
        short_name: 'Phòng mạch',
        lang: 'vi',
        start_url: '/',
        display: 'standalone',
        background_color: '#f4f7f7',
        theme_color: '#0f766e',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Chỉ lưu vỏ ứng dụng. KHÔNG lưu phản hồi /api (có dữ liệu bệnh nhân): bộ nhớ ngoại tuyến có mã hóa là việc của M0-S3.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,png}'],
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': bff } },
  preview: { port: 4173, proxy: { '/api': bff } },
});
