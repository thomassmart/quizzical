import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { requireHost } from '../middleware/auth.js';
import { query } from '../db/client.js';
import { MediaStoreError, storeMediaAsset } from '../services/mediaStore.js';

export async function mediaRoutes(app: FastifyInstance) {
  await fs.mkdir(config.mediaDir, { recursive: true });

  app.post('/api/host/media', { preHandler: requireHost }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file' });
    try {
      const buf = await file.toBuffer();
      const media = await storeMediaAsset({
        filename: file.filename,
        mimeType: file.mimetype,
        data: buf,
      });
      return {
        media: {
          id: media.id,
          filename: media.filename,
          mime_type: media.mime_type,
          size_bytes: media.size_bytes,
        },
        url: media.url,
      };
    } catch (err) {
      if (err instanceof MediaStoreError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get('/media/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await query<{
      storage_path: string;
      mime_type: string;
    }>(`SELECT storage_path, mime_type FROM media_assets WHERE id = $1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    const full = path.join(config.mediaDir, rows[0].storage_path);
    const data = await fs.readFile(full);
    return reply.type(rows[0].mime_type).send(data);
  });
}
