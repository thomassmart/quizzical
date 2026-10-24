import 'dotenv/config';
import path from 'node:path';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://quizzical:quizzical@localhost:5432/quizzical',
  hostPassword: process.env.HOST_PASSWORD ?? 'changeme',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production',
  /** Bearer token for Streamable HTTP MCP at POST /mcp. Empty = MCP disabled. */
  mcpToken: process.env.MCP_TOKEN ?? '',
  mediaDir: path.resolve(process.env.MEDIA_DIR ?? './media'),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? '',
    apiKey: process.env.LLM_API_KEY ?? '',
    chatModel: process.env.LLM_CHAT_MODEL ?? 'gpt-4o-2024-05-13',
    embedModel: process.env.LLM_EMBED_MODEL ?? 'nomic-embed-text-v1-5',
    fallbackChatModel:
      process.env.LLM_FALLBACK_CHAT_MODEL ?? 'granite-3-8b-instruct',
  },
  semanticSimilarityThreshold: Number(
    process.env.SEMANTIC_SIMILARITY_THRESHOLD ?? 0.88,
  ),
  /** Max decoded media upload size (multipart + MCP base64). */
  maxUploadBytes: 25 * 1024 * 1024,
  /**
   * Fastify JSON body limit. Base64 expands ~4/3 vs binary, so this is
   * higher than maxUploadBytes to allow ~25 MB clips via upload_media.
   */
  bodyLimitBytes: 35 * 1024 * 1024,
  allowedMime: new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'audio/x-wav',
    'audio/mp4',
    'video/mp4',
    'video/webm',
    'video/quicktime',
  ]),
};

export function llmConfigured(): boolean {
  return Boolean(config.llm.baseUrl && config.llm.apiKey);
}
