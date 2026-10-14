import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8090';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    host: true,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
