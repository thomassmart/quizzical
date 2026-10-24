import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hostInject, toolResultFromInject } from './hostClient.js';
import {
  decodeBase64Payload,
  MediaStoreError,
  storeMediaAsset,
} from '../services/mediaStore.js';

const uuid = z.string().uuid();
const difficulty = z.enum(['easy', 'medium', 'hard']);
const questionFormat = z.enum([
  'multiple_choice',
  'short_answer',
  'ordered_list',
  'matching',
]);
const mediaSlot = z.enum(['image', 'audio', 'video', 'reveal_image']);
const revealImageIdField = uuid
  .nullable()
  .optional()
  .describe(
    'Answer-sheet image id (reveal only — not shown during the live question). Null clears.',
  );

/** Canonical tool names — every entry must be registered in createQuizzicalMcpServer. */
export const QUIZZICAL_MCP_TOOL_NAMES = [
  'list_series',
  'create_series',
  'list_events',
  'create_event',
  'get_event',
  'duplicate_event',
  'export_event',
  'import_event',
  'suggest_section_themes',
  'create_section',
  'update_section',
  'reorder_sections',
  'delete_section',
  'create_question',
  'get_question',
  'update_question',
  'approve_question',
  'dismiss_question',
  'propose_questions',
  'resolve_duplicate',
  'get_series_history',
  'upload_media',
  'set_question_media',
  'list_section_topic_images',
  'set_section_topic_images',
  'add_section_topic_image',
  'replace_section_topic_image',
  'remove_section_topic_image',
  'clear_section_topic_images',
  'refresh_section_topic_images',
  'replace_question_media',
] as const;

function jsonToolResult(
  body: unknown,
  isError = false,
): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
  };
}

/** Resolve a media asset id from an existing UUID or an inline base64 upload. */
async function resolveMediaId(args: {
  mediaId?: string;
  filename?: string;
  mimeType?: string;
  base64?: string;
}): Promise<string> {
  if (args.mediaId) return args.mediaId;
  if (!args.filename || !args.mimeType || !args.base64) {
    throw new MediaStoreError(
      'Provide mediaId, or filename + mimeType + base64 to upload',
    );
  }
  const data = decodeBase64Payload(args.base64);
  const media = await storeMediaAsset({
    filename: args.filename,
    mimeType: args.mimeType,
    data,
  });
  return media.id;
}

const topicImageInput = z.object({
  mediaId: uuid.optional().describe('Existing media asset id from upload_media'),
  filename: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  base64: z.string().min(1).optional(),
  alt: z.string().optional(),
});

export function createQuizzicalMcpServer(app: FastifyInstance): McpServer {
  const server = new McpServer({
    name: 'quizzical',
    version: '1.0.0',
  });

  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
  ) => toolResultFromInject(await hostInject(app, { method, url, body }));

  server.registerTool(
    'list_series',
    {
      description: 'List all quiz series (newest first).',
    },
    async () => call('GET', '/api/host/series'),
  );

  server.registerTool(
    'create_series',
    {
      description: 'Create a new quiz series.',
      inputSchema: {
        name: z.string().describe('Series name'),
        description: z.string().optional().describe('Optional description'),
      },
    },
    async (args) =>
      call('POST', '/api/host/series', {
        name: args.name,
        description: args.description,
      }),
  );

  server.registerTool(
    'list_events',
    {
      description: 'List events in a series.',
      inputSchema: {
        seriesId: uuid.describe('Series UUID'),
      },
    },
    async (args) => call('GET', `/api/host/series/${args.seriesId}/events`),
  );

  server.registerTool(
    'create_event',
    {
      description: 'Create a draft event (night) in a series.',
      inputSchema: {
        seriesId: uuid.describe('Series UUID'),
        name: z.string().describe('Event name'),
      },
    },
    async (args) =>
      call('POST', `/api/host/series/${args.seriesId}/events`, {
        name: args.name,
      }),
  );

  server.registerTool(
    'get_event',
    {
      description: 'Get an event with its sections and questions.',
      inputSchema: {
        eventId: uuid.describe('Event UUID'),
      },
    },
    async (args) => call('GET', `/api/host/events/${args.eventId}`),
  );

  server.registerTool(
    'duplicate_event',
    {
      description:
        'Duplicate an event structure (sections only; questions are not copied).',
      inputSchema: {
        eventId: uuid.describe('Source event UUID'),
      },
    },
    async (args) => call('POST', `/api/host/events/${args.eventId}/duplicate`),
  );

  server.registerTool(
    'export_event',
    {
      description: 'Export an event question pack (quizzical.questions/1).',
      inputSchema: {
        eventId: uuid.describe('Event UUID'),
      },
    },
    async (args) => call('GET', `/api/host/events/${args.eventId}/export`),
  );

  server.registerTool(
    'import_event',
    {
      description:
        'Import a question pack into an event (creates sections/questions as needed).',
      inputSchema: {
        eventId: uuid.describe('Target event UUID'),
        pack: z.unknown().describe('Export pack or questions[] payload'),
        approve: z
          .boolean()
          .optional()
          .describe('Approve imported questions (default true)'),
      },
    },
    async (args) =>
      call('POST', `/api/host/events/${args.eventId}/import`, {
        pack: args.pack,
        approve: args.approve,
      }),
  );

  server.registerTool(
    'suggest_section_themes',
    {
      description: 'Suggest section themes for an event (LLM or fallback list).',
      inputSchema: {
        eventId: uuid.describe('Event UUID'),
      },
    },
    async (args) =>
      call('GET', `/api/host/events/${args.eventId}/section-suggestions`),
  );

  server.registerTool(
    'create_section',
    {
      description:
        'Create a section (round). May auto-propose LLM questions when configured. Optionally set Get Ready mosaic photos via topicImages (writable section media).',
      inputSchema: {
        eventId: uuid.describe('Event UUID'),
        title: z.string(),
        theme: z.string().optional(),
        questionCountTarget: z.number().int().min(1).max(20).optional(),
        difficulty: difficulty.optional(),
        autoOpenAnswers: z.boolean().optional(),
        autoPropose: z
          .boolean()
          .optional()
          .describe('Propose LLM questions after create (default true)'),
        topicImages: z
          .array(topicImageInput)
          .max(24)
          .optional()
          .describe(
            'Optional Get Ready mosaic photos (mediaId or inline base64 upload). Display order preserved.',
          ),
      },
    },
    async (args) => {
      const { eventId, topicImages, ...body } = args;
      const created = await hostInject(app, {
        method: 'POST',
        url: `/api/host/events/${eventId}/sections`,
        body,
      });
      if (created.statusCode < 200 || created.statusCode >= 300) {
        return toolResultFromInject(created);
      }
      if (!topicImages?.length) return toolResultFromInject(created);

      const sectionId =
        (created.body as { section?: { id?: string }; id?: string })?.section
          ?.id ?? (created.body as { id?: string })?.id;
      if (!sectionId) {
        return jsonToolResult(
          {
            warning: 'Section created but id missing; topic images not set',
            body: created.body,
          },
          true,
        );
      }
      try {
        const images = [];
        for (const img of topicImages) {
          const mediaId = await resolveMediaId(img);
          images.push({ mediaId, alt: img.alt ?? '' });
        }
        const mosaic = await hostInject(app, {
          method: 'PUT',
          url: `/api/host/sections/${sectionId}/topic-images`,
          body: { images },
        });
        return jsonToolResult({
          section: created.body,
          topicImages: mosaic.body,
        });
      } catch (err) {
        return jsonToolResult(
          {
            error:
              err instanceof MediaStoreError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'Failed to set topic images',
            section: created.body,
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    'update_section',
    {
      description: 'Update a section title, theme, difficulty, or targets.',
      inputSchema: {
        sectionId: uuid,
        title: z.string().min(1).optional(),
        theme: z.string().min(1).optional(),
        difficulty: difficulty.optional(),
        questionCountTarget: z.number().int().min(1).max(20).optional(),
        autoOpenAnswers: z.boolean().optional(),
      },
    },
    async (args) => {
      const { sectionId, ...body } = args;
      return call('PATCH', `/api/host/sections/${sectionId}`, body);
    },
  );

  server.registerTool(
    'reorder_sections',
    {
      description: 'Reorder sections within an event.',
      inputSchema: {
        eventId: uuid,
        orderedIds: z.array(uuid).describe('Section IDs in desired order'),
      },
    },
    async (args) =>
      call('PATCH', '/api/host/sections/reorder', {
        eventId: args.eventId,
        orderedIds: args.orderedIds,
      }),
  );

  server.registerTool(
    'delete_section',
    {
      description:
        'Delete a section (not practice/demo; blocked if reserved/used questions).',
      inputSchema: {
        sectionId: uuid,
      },
    },
    async (args) => call('DELETE', `/api/host/sections/${args.sectionId}`),
  );

  server.registerTool(
    'create_question',
    {
      description: 'Create a question under a section.',
      inputSchema: {
        sectionId: uuid,
        format: questionFormat,
        wording: z.string().min(1),
        answerSpec: z.unknown(),
        rubric: z.string().optional(),
        difficulty: difficulty.optional(),
        themeTags: z.array(z.string()).optional(),
        points: z.number().int().positive().optional(),
        timingSeconds: z.number().int().positive().optional(),
        sourceReferences: z.array(z.string()).optional(),
        sourcesVerified: z.boolean().optional(),
        mediaImageId: uuid
          .nullable()
          .optional()
          .describe('Prompt image shown during the question'),
        mediaAudioId: uuid.nullable().optional(),
        mediaVideoId: uuid.nullable().optional(),
        hostNotes: z.string().optional(),
        revealFact: z.string().nullable().optional(),
        revealImageId: revealImageIdField,
        approve: z.boolean().optional(),
      },
    },
    async (args) => {
      const { sectionId, ...body } = args;
      return call('POST', `/api/host/sections/${sectionId}/questions`, body);
    },
  );

  server.registerTool(
    'get_question',
    {
      description: 'Get a single question by ID.',
      inputSchema: {
        questionId: uuid,
      },
    },
    async (args) => call('GET', `/api/host/questions/${args.questionId}`),
  );

  server.registerTool(
    'update_question',
    {
      description: 'Update a question (not used/abandoned).',
      inputSchema: {
        questionId: uuid,
        wording: z.string().min(1).optional(),
        answerSpec: z.unknown().optional(),
        rubric: z.string().optional(),
        difficulty: difficulty.optional(),
        points: z.number().int().positive().optional(),
        timingSeconds: z.number().int().positive().optional(),
        sourceReferences: z.array(z.string()).optional(),
        sourcesVerified: z.boolean().optional(),
        mediaImageId: uuid
          .nullable()
          .optional()
          .describe('Prompt image shown during the question'),
        mediaAudioId: uuid.nullable().optional(),
        mediaVideoId: uuid.nullable().optional(),
        hostNotes: z.string().nullable().optional(),
        revealFact: z.string().nullable().optional(),
        revealImageId: revealImageIdField,
        status: z
          .enum(['draft', 'proposed', 'approved', 'reserved'])
          .optional()
          .describe(
            'Use reserved for questions on a prepared/live-ready event (matches freeze).',
          ),
      },
    },
    async (args) => {
      const { questionId, ...body } = args;
      return call('PATCH', `/api/host/questions/${questionId}`, body);
    },
  );

  server.registerTool(
    'approve_question',
    {
      description: 'Approve a draft/proposed/dismissed question.',
      inputSchema: {
        questionId: uuid,
      },
    },
    async (args) =>
      call('POST', `/api/host/questions/${args.questionId}/approve`),
  );

  server.registerTool(
    'dismiss_question',
    {
      description: 'Dismiss a question (excluded from future reuse memory).',
      inputSchema: {
        questionId: uuid,
      },
    },
    async (args) =>
      call('POST', `/api/host/questions/${args.questionId}/dismiss`),
  );

  server.registerTool(
    'propose_questions',
    {
      description:
        'LLM-propose questions for a section (requires LLM configured).',
      inputSchema: {
        sectionId: uuid,
      },
    },
    async (args) =>
      call('POST', `/api/host/sections/${args.sectionId}/generate`),
  );

  server.registerTool(
    'resolve_duplicate',
    {
      description: 'Resolve a near-duplicate candidate.',
      inputSchema: {
        id: uuid.describe('Duplicate candidate UUID'),
        resolution: z.enum(['keep', 'dismiss_new', 'dismiss_existing']),
      },
    },
    async (args) =>
      call('POST', `/api/host/duplicates/${args.id}/resolve`, {
        resolution: args.resolution,
      }),
  );

  server.registerTool(
    'get_series_history',
    {
      description: 'Recent question history for a series (used/dismissed/etc.).',
      inputSchema: {
        seriesId: uuid,
      },
    },
    async (args) => call('GET', `/api/host/series/${args.seriesId}/history`),
  );

  server.registerTool(
    'upload_media',
    {
      description:
        'Upload a media asset (image/audio/video) from base64 or a data URL. Returns media id + /media/:id URL. Max decoded size 25 MB (short video clips OK). Allowed MIME: jpeg/png/webp/gif, mp3/wav/ogg/webm/m4a, mp4/webm/mov.',
      inputSchema: {
        filename: z.string().min(1).describe('Original filename with extension'),
        mimeType: z
          .string()
          .min(1)
          .describe('MIME type, e.g. image/png or audio/mpeg'),
        base64: z
          .string()
          .min(1)
          .describe('Raw base64 or data:...;base64,... payload (max ~25 MB decoded)'),
      },
    },
    async (args) => {
      try {
        // Yield so other HTTP/MCP requests can progress during large decode.
        await new Promise<void>((r) => setImmediate(r));
        const data = decodeBase64Payload(args.base64);
        await new Promise<void>((r) => setImmediate(r));
        const media = await storeMediaAsset({
          filename: args.filename,
          mimeType: args.mimeType,
          data,
        });
        return jsonToolResult({ media, url: media.url });
      } catch (err) {
        const message =
          err instanceof MediaStoreError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Upload failed';
        return jsonToolResult({ error: message }, true);
      }
    },
  );

  server.registerTool(
    'set_question_media',
    {
      description:
        'Attach or clear media slots on a question. mediaImageId/audio/video are prompt media (shown during the question). revealImageId is the answer-sheet image (shown only during section answer reveal). Pass a media asset UUID to set, or null to clear. Omitted slots are left unchanged. Typical flow: upload_media → set revealImageId.',
      inputSchema: {
        questionId: uuid,
        mediaImageId: uuid
          .nullable()
          .optional()
          .describe('Prompt image asset id, or null to clear'),
        mediaAudioId: uuid
          .nullable()
          .optional()
          .describe('Audio asset id, or null to clear'),
        mediaVideoId: uuid
          .nullable()
          .optional()
          .describe('Video asset id, or null to clear'),
        revealImageId: revealImageIdField,
      },
    },
    async (args) => {
      const { questionId, ...body } = args;
      return call('PATCH', `/api/host/questions/${questionId}`, body);
    },
  );

  server.registerTool(
    'list_section_topic_images',
    {
      description:
        'Read Get Ready mosaic photos for a section (media ids + /media URLs). Pair with set/add/replace/remove_section_topic_image* to write.',
      inputSchema: {
        sectionId: uuid,
      },
    },
    async (args) =>
      call('GET', `/api/host/sections/${args.sectionId}/topic-images`),
  );

  server.registerTool(
    'set_section_topic_images',
    {
      description:
        'Write (replace) the full Get Ready photo mosaic for a section. Pass images in display order — each entry may use mediaId from upload_media, or filename/mimeType/base64 for an inline upload. Pass images:[] to clear the mosaic.',
      inputSchema: {
        sectionId: uuid,
        images: z
          .array(topicImageInput)
          .max(24)
          .describe('Ordered mosaic slots; empty array clears all photos'),
      },
    },
    async (args) => {
      try {
        const images = [];
        for (const img of args.images) {
          const mediaId = await resolveMediaId(img);
          images.push({ mediaId, alt: img.alt ?? '' });
        }
        return call('PUT', `/api/host/sections/${args.sectionId}/topic-images`, {
          images,
        });
      } catch (err) {
        return jsonToolResult(
          {
            error:
              err instanceof MediaStoreError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'Set topic images failed',
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    'add_section_topic_image',
    {
      description:
        'Write: append (or insert) one Get Ready mosaic photo. Provide mediaId from upload_media, or filename/mimeType/base64 to upload inline.',
      inputSchema: {
        sectionId: uuid,
        mediaId: uuid.optional(),
        filename: z.string().min(1).optional(),
        mimeType: z.string().min(1).optional(),
        base64: z.string().min(1).optional(),
        alt: z.string().optional(),
        index: z
          .number()
          .int()
          .min(0)
          .max(20)
          .optional()
          .describe('Optional insert index; omit to append'),
      },
    },
    async (args) => {
      try {
        const mediaId = await resolveMediaId(args);
        return call('POST', `/api/host/sections/${args.sectionId}/topic-images`, {
          mediaId,
          alt: args.alt,
          index: args.index,
        });
      } catch (err) {
        return jsonToolResult(
          {
            error:
              err instanceof MediaStoreError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'Add failed',
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    'replace_section_topic_image',
    {
      description:
        'Write: replace one Get Ready mosaic slot by index. Provide mediaId, or filename/mimeType/base64 to upload inline.',
      inputSchema: {
        sectionId: uuid,
        index: z.number().int().min(0).max(20),
        mediaId: uuid.optional(),
        filename: z.string().min(1).optional(),
        mimeType: z.string().min(1).optional(),
        base64: z.string().min(1).optional(),
        alt: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const mediaId = await resolveMediaId(args);
        return call(
          'PUT',
          `/api/host/sections/${args.sectionId}/topic-images/${args.index}`,
          { mediaId, alt: args.alt },
        );
      } catch (err) {
        return jsonToolResult(
          {
            error:
              err instanceof MediaStoreError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'Replace failed',
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    'remove_section_topic_image',
    {
      description: 'Write: remove one Get Ready mosaic photo by index.',
      inputSchema: {
        sectionId: uuid,
        index: z.number().int().min(0).max(20),
      },
    },
    async (args) =>
      call(
        'DELETE',
        `/api/host/sections/${args.sectionId}/topic-images/${args.index}`,
      ),
  );

  server.registerTool(
    'clear_section_topic_images',
    {
      description:
        'Write: clear all Get Ready mosaic photos for a section (same as set_section_topic_images with images:[]).',
      inputSchema: {
        sectionId: uuid,
      },
    },
    async (args) =>
      call('PUT', `/api/host/sections/${args.sectionId}/topic-images`, {
        images: [],
      }),
  );

  server.registerTool(
    'refresh_section_topic_images',
    {
      description:
        'Write: regenerate the Get Ready mosaic from the section theme (Openverse / fallbacks). Overwrites the current mosaic.',
      inputSchema: {
        sectionId: uuid,
      },
    },
    async (args) =>
      call(
        'POST',
        `/api/host/sections/${args.sectionId}/topic-images/refresh`,
        {},
      ),
  );

  server.registerTool(
    'replace_question_media',
    {
      description:
        'Upload new media and assign it to one question slot (image, audio, video, or reveal_image for answer-sheet), replacing whatever was there. reveal_image is images-only and shown only during answer reveal. Pass clear:true with no base64 to clear the slot without uploading.',
      inputSchema: {
        questionId: uuid,
        slot: mediaSlot.describe(
          'image/audio/video = prompt media; reveal_image = answer-sheet image',
        ),
        filename: z
          .string()
          .min(1)
          .optional()
          .describe('Required unless clear is true'),
        mimeType: z
          .string()
          .min(1)
          .optional()
          .describe('Required unless clear is true'),
        base64: z
          .string()
          .min(1)
          .optional()
          .describe('Required unless clear is true'),
        clear: z
          .boolean()
          .optional()
          .describe('If true, clear the slot (no upload)'),
      },
    },
    async (args) => {
      const field =
        args.slot === 'image'
          ? 'mediaImageId'
          : args.slot === 'audio'
            ? 'mediaAudioId'
            : args.slot === 'video'
              ? 'mediaVideoId'
              : 'revealImageId';

      if (args.clear) {
        return call('PATCH', `/api/host/questions/${args.questionId}`, {
          [field]: null,
        });
      }

      if (!args.filename || !args.mimeType || !args.base64) {
        return jsonToolResult(
          {
            error:
              'filename, mimeType, and base64 are required unless clear is true',
          },
          true,
        );
      }

      if (
        args.slot === 'reveal_image' &&
        !args.mimeType.toLowerCase().startsWith('image/')
      ) {
        return jsonToolResult(
          { error: 'reveal_image slot accepts image MIME types only' },
          true,
        );
      }

      try {
        await new Promise<void>((r) => setImmediate(r));
        const data = decodeBase64Payload(args.base64);
        await new Promise<void>((r) => setImmediate(r));
        const media = await storeMediaAsset({
          filename: args.filename,
          mimeType: args.mimeType,
          data,
        });
        const patched = await hostInject(app, {
          method: 'PATCH',
          url: `/api/host/questions/${args.questionId}`,
          body: { [field]: media.id },
        });
        if (patched.statusCode < 200 || patched.statusCode >= 300) {
          return toolResultFromInject(patched);
        }
        return jsonToolResult({
          slot: args.slot,
          media,
          url: media.url,
          question: patched.body,
        });
      } catch (err) {
        const message =
          err instanceof MediaStoreError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Replace failed';
        return jsonToolResult({ error: message }, true);
      }
    },
  );

  return server;
}
