import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { query } from './db/client.js';
import { pendingMigrations, runMigrations } from './db/migrate.js';
import { authRoutes } from './routes/auth.js';
import { prepRoutes } from './routes/prep.js';
import { liveRoutes } from './routes/live.js';
import { mediaRoutes } from './routes/media.js';
import { topicImageRoutes } from './routes/topicImages.js';
import { mcpRoutes } from './mcp/routes.js';
import { hub } from './ws/hub.js';
import {
  pauseAllLiveEventsOnBoot,
  setGameplayHub,
  tickTimers,
} from './services/gameplay.js';

async function main() {
  try {
    const { applied } = await runMigrations({ endPool: false });
    if (applied.length) {
      console.log(
        `Applied ${applied.length} migration(s) on boot: ${applied.join(', ')}`,
      );
    }
  } catch (err) {
    console.error('FATAL: database migrations failed on startup — refusing to start');
    console.error(err);
    process.exit(1);
  }

  const app = Fastify({
    logger: true,
    // Base64 media uploads inflate ~4/3; keep headroom above maxUploadBytes.
    bodyLimit: config.bodyLimitBytes,
    requestTimeout: 300_000,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes },
  });
  await app.register(websocket);

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await query('SELECT 1');
      const pending = await pendingMigrations();
      if (pending.length) {
        app.log.error({ pending }, 'readyz: pending migrations');
        return reply.code(503).send({
          ok: false,
          error: 'pending_migrations',
          pending,
        });
      }
      return { ok: true };
    } catch (err) {
      app.log.error({ err }, 'readyz failed');
      return reply.code(503).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await authRoutes(app);
  await prepRoutes(app);
  await liveRoutes(app);
  await mediaRoutes(app);
  await topicImageRoutes(app);
  await mcpRoutes(app);

  app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket, req) => {
      const url = new URL(req.url, 'http://localhost');
      const eventId = url.searchParams.get('eventId');
      const token = url.searchParams.get('token');
      hub.add(socket, { eventId, token });
    });
  });

  setGameplayHub(hub);
  await pauseAllLiveEventsOnBoot();
  setInterval(() => {
    void tickTimers().catch((err) => app.log.error(err));
  }, 500);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Quizzical API on :${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
