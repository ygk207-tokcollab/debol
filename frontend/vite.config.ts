
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  const backend =
    env.VITE_BACKEND_URL || 'http://127.0.0.1:8090';

  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_PORT || 5173),
      host: true,
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
