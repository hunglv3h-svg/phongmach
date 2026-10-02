import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // BFF mà `/api` trỏ tới và cổng của bản build đọc từ biến môi trường, để chạy thêm một giao diện riêng cho bài e2e 20 chu kỳ
  // (BFF 8111, bản build ở 4174) bên cạnh giao diện demo. Không đặt thì như cũ.
  const env = loadEnv(mode, '.', ['BFF_URL', 'PREVIEW_PORT']);
  const bff = env['BFF_URL'] || 'http://127.0.0.1:8110';
  const previewPort = Number(env['PREVIEW_PORT'] || 4173);

  return {
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
          // Chỉ lưu vỏ ứng dụng. KHÔNG lưu phản hồi /api (có dữ liệu bệnh nhân): dữ liệu dùng khi mất mạng nằm trong kho mã hóa trên máy
          // (`src/local/store.ts`), không đi qua service worker.
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          globPatterns: ['**/*.{js,css,html,png}'],
        },
      }),
    ],
    server: { port: 5173, proxy: { '/api': bff } },
    preview: { port: previewPort, proxy: { '/api': bff } },
  };
});
