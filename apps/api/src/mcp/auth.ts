import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7);
}

/** Constant-time compare of MCP bearer token. False when MCP_TOKEN is unset. */
export function verifyMcpToken(req: FastifyRequest): boolean {
  const expected = config.mcpToken;
  if (!expected) return false;
  const provided = bearer(req);
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function mcpEnabled(): boolean {
  return Boolean(config.mcpToken);
}
