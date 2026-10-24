import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client.js';
import { requireHost } from '../middleware/auth.js';
import {
  ensureSectionTopicImages,
  getSectionTopicImages,
  removeSectionTopicImageAt,
  replaceSectionTopicImageAt,
  setSectionTopicImages,
  topicImageUrls,
  type StoredTopicImage,
} from '../services/topicImages.js';

function present(stored: StoredTopicImage[]) {
  return topicImageUrls(stored).map((url, i) => ({
    index: i,
    mediaId: stored[i]!.mediaId,
    url,
    thumb: url,
    alt: stored[i]?.alt ?? '',
  }));
}

export async function topicImageRoutes(app: FastifyInstance) {
  /** Prefetched images for a section (served from local media). */
  app.get('/api/topic-images', async (req) => {
    const q = z
      .object({
        sectionId: z.string().uuid(),
      })
      .parse(req.query);

    const stored = await getSectionTopicImages(q.sectionId);
    return { images: present(stored) };
  });

  app.get(
    '/api/host/sections/:sectionId/topic-images',
    { preHandler: requireHost },
    async (req, reply) => {
      const { sectionId } = req.params as { sectionId: string };
      const { rows } = await query(`SELECT id FROM sections WHERE id = $1`, [
        sectionId,
      ]);
      if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
      const stored = await getSectionTopicImages(sectionId);
      return { images: present(stored) };
    },
  );

  /** Replace the full mosaic (order preserved). */
  app.put(
    '/api/host/sections/:sectionId/topic-images',
    { preHandler: requireHost },
    async (req, reply) => {
      const { sectionId } = req.params as { sectionId: string };
      const body = z
        .object({
          images: z
            .array(
              z.object({
                mediaId: z.string().uuid(),
                alt: z.string().optional(),
              }),
            )
            .max(24),
        })
        .parse(req.body);
      try {
        const stored = await setSectionTopicImages(
          sectionId,
          body.images.map((img) => ({
            mediaId: img.mediaId,
            alt: img.alt ?? '',
          })),
        );
        return { images: present(stored) };
      } catch (err) {
        return reply
          .code(404)
          .send({ error: err instanceof Error ? err.message : 'Not found' });
      }
    },
  );

  /** Append one image (or insert at index). */
  app.post(
    '/api/host/sections/:sectionId/topic-images',
    { preHandler: requireHost },
    async (req, reply) => {
      const { sectionId } = req.params as { sectionId: string };
      const body = z
        .object({
          mediaId: z.string().uuid(),
          alt: z.string().optional(),
          index: z.number().int().min(0).max(20).optional(),
        })
        .parse(req.body);
      try {
        const current = await getSectionTopicImages(sectionId);
        const entry = { mediaId: body.mediaId, alt: body.alt ?? '' };
        let next: StoredTopicImage[];
        if (body.index === undefined || body.index >= current.length) {
          next = [...current, entry];
        } else {
          next = [...current];
          next.splice(body.index, 0, entry);
        }
        const stored = await setSectionTopicImages(sectionId, next);
        return { images: present(stored) };
      } catch (err) {
        return reply
          .code(404)
          .send({ error: err instanceof Error ? err.message : 'Not found' });
      }
    },
  );

  /** Replace one mosaic slot. */
  app.put(
    '/api/host/sections/:sectionId/topic-images/:index',
    { preHandler: requireHost },
    async (req, reply) => {
      const { sectionId, index: indexRaw } = req.params as {
        sectionId: string;
        index: string;
      };
      const index = Number(indexRaw);
      if (!Number.isInteger(index) || index < 0) {
        return reply.code(400).send({ error: 'Invalid index' });
      }
      const body = z
        .object({
          mediaId: z.string().uuid(),
          alt: z.string().optional(),
        })
        .parse(req.body);
      try {
        const stored = await replaceSectionTopicImageAt(sectionId, index, {
          mediaId: body.mediaId,
          alt: body.alt ?? '',
        });
        return { images: present(stored) };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'Failed' });
      }
    },
  );

  app.delete(
    '/api/host/sections/:sectionId/topic-images/:index',
    { preHandler: requireHost },
    async (req, reply) => {
      const { sectionId, index: indexRaw } = req.params as {
        sectionId: string;
        index: string;
      };
      const index = Number(indexRaw);
      if (!Number.isInteger(index) || index < 0) {
        return reply.code(400).send({ error: 'Invalid index' });
      }
      try {
        const stored = await removeSectionTopicImageAt(sectionId, index);
        return { images: present(stored) };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'Failed' });
      }
    },
  );

  /** Re-fetch / regenerate mosaic from the section theme. */
  app.post(
    '/api/host/sections/:sectionId/topic-images/refresh',
    { preHandler: requireHost },
    async (req, reply) => {
      const { sectionId } = req.params as { sectionId: string };
      try {
        const stored = await ensureSectionTopicImages(sectionId, {
          force: true,
        });
        return { images: present(stored) };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'Refresh failed' });
      }
    },
  );
}
