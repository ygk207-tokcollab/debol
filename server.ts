
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/api';
import { db } from './server/data';
import { migrate, dbEnabled, closePool } from './server/db';
import { hydrate, isEmpty, persistAll, flushPersist } from './server/persist';
import { bootstrapAdminPassword } from './server/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Render can start the service before Neon's pooler accepts connections, so the first attempt usually
 * needs a retry. If it still fails we exit rather than serve an in-memory catalogue that silently
 * throws away every order.
 */
async function connectDatabase() {
  const attempts = Number(process.env.DB_CONNECT_ATTEMPTS || 5);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await migrate();
      if (await isEmpty()) {
        await persistAll(db);
        console.log('[db] empty database detected - seeded the catalogue from docs/api-samples');
      } else {
        await hydrate(db);
      }
      const emails = await bootstrapAdminPassword();
      if (emails.length) console.log(`[auth] ADMIN_BOOTSTRAP_PASSWORD applied to ${emails.join(', ')} - change these from the administrators screen`);
      return;
    } catch (err) {
      console.error(`[db] connection attempt ${attempt}/${attempts} failed: ${(err as Error).message}`);
      if (attempt < attempts) await sleep(2000 * attempt);
    }
  }
  console.error('[db] giving up: DATABASE_URL is set but the database is unreachable. Unset DATABASE_URL to run the in-memory demo, or fix the connection string.');
  process.exit(1);
}

function corsOptions() {
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (allowed.length) {
    return { origin: allowed };
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[cors] ALLOWED_ORIGINS is not set, so any origin can call this API. Set it to your site origin(s) once the frontend lives on another host.');
  }
  return { origin: true };
}

async function startServer() {
  if (dbEnabled()) {
    await connectDatabase();
  } else {
    console.log('[db] DATABASE_URL is not set - running the in-memory demo store; nothing is persisted');
    // The hash lives in this process only, so the same variable has to be present after every restart.
    const emails = await bootstrapAdminPassword();
    if (emails.length) console.log(`[auth] ADMIN_BOOTSTRAP_PASSWORD applied to ${emails.join(', ')} (memory only)`);
  }

  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const HOST = '0.0.0.0';

  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '1mb' }));

  // Serve media files if any
  app.use(
    '/api/v1/media',
    express.static(path.resolve(__dirname, 'public'))
  );
  app.use(
    '/media',
    express.static(path.resolve(__dirname, 'public'))
  );

  // Health checks
  const health = (_req: express.Request, res: express.Response) => {
    res.status(200).json({ status: 'UP', persistence: dbEnabled() ? 'postgres' : 'memory-only' });
  };
  app.get('/health', health);
  app.get('/actuator/health', health);

  // API routes
  app.use('/api/v1', apiRouter);
  app.use('/api', apiRouter);

  if (process.env.NODE_ENV === 'production') {
    // Serve the built Vite frontend
    const distPath = path.resolve(__dirname, 'dist');

    app.use(express.static(distPath));

    // SPA fallback: supports Express 5 and React Router
    app.use((_req, res, next) => {
      res.sendFile(
        path.resolve(distPath, 'index.html'),
        (err) => {
          if (err) next(err);
        }
      );
    });
  } else {
    // Vite development mode
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server listening at http://${HOST}:${PORT}`);
  });

  // Render sends SIGTERM on every deploy/restart; queued writes must land before the process dies.
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal}: closing connections and flushing pending writes`);
    server.close();
    try {
      await flushPersist();
      await closePool();
    } catch (err) {
      console.error('[shutdown] flush failed:', (err as Error).message);
      process.exitCode = 1;
    }
    process.exit();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
