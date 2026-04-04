import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Tauri APIs are only available in the desktop app — externalize them
      external: ['@tauri-apps/api/core', '@tauri-apps/api/event'],
    },
  },
  server: {
    port: 3200,
    proxy: {
      '/api': 'http://localhost:3100',
      '/ws': {
        target: 'ws://localhost:3100',
        ws: true,
      },
    },
  },
});
