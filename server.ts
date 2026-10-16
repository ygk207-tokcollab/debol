import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const HOST = '0.0.0.0';

  app.use(cors());
  app.use(express.json());

  // Serve media files if any
  app.use('/api/v1/media', express.static(path.resolve(__dirname, 'public')));
  app.use('/media', express.static(path.resolve(__dirname, 'public')));

  // Health check endpoints for Render and monitors
  app.get('/health', (_req, res) => res.status(200).json({ status: 'UP' }));
  app.get('/actuator/health', (_req, res) => res.status(200).json({ status: 'UP' }));

  // Mount API router
  app.use('/api/v1', apiRouter);
  app.use('/api', apiRouter);

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server listening at http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
