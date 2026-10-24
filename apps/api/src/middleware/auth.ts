import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  verifyToken,
  type HostClaims,
  type TeamClaims,
  type WallClaims,
} from '../auth/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: HostClaims | TeamClaims | WallClaims;
  }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7);
}

export async function requireHost(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const token = bearer(req);
    if (!token) throw new Error('Missing token');
    const claims = await verifyToken(token);
    if (claims.role !== 'host') throw new Error('Host required');
    req.auth = claims;
  } catch {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireTeam(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const token = bearer(req);
    if (!token) throw new Error('Missing token');
    const claims = await verifyToken(token);
    if (claims.role !== 'team') throw new Error('Team required');
    req.auth = claims;
  } catch {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireWall(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const token = bearer(req);
    if (!token) throw new Error('Missing token');
    const claims = await verifyToken(token);
    if (claims.role !== 'wallboard') throw new Error('Wallboard required');
    req.auth = claims;
  } catch {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}
