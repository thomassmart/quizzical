import type { FastifyInstance, HTTPMethods, LightMyRequestResponse } from 'fastify';
import { signToken } from '../auth/tokens.js';

export type HostInjectResult = {
  statusCode: number;
  body: unknown;
};

/**
 * Call an existing /api/host/* route with a short-lived host JWT via Fastify inject.
 */
export async function hostInject(
  app: FastifyInstance,
  opts: {
    method: HTTPMethods;
    url: string;
    body?: unknown;
  },
): Promise<HostInjectResult> {
  const token = await signToken({ role: 'host', sub: 'host' }, '5m');
  const res: LightMyRequestResponse = await app.inject({
    method: opts.method,
    url: opts.url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(opts.body !== undefined
        ? { 'content-type': 'application/json' }
        : {}),
    },
    ...(opts.body !== undefined
      ? { payload: opts.body as string | object | Buffer }
      : {}),
  });

  let body: unknown = res.body;
  try {
    body = JSON.parse(res.body);
  } catch {
    // keep raw string
  }

  return { statusCode: res.statusCode, body };
}

export function toolResultFromInject(result: HostInjectResult): {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
} {
  const text = JSON.stringify(result.body, null, 2);
  if (result.statusCode >= 200 && result.statusCode < 300) {
    return { content: [{ type: 'text', text }] };
  }
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            error: 'Host API request failed',
            statusCode: result.statusCode,
            body: result.body,
          },
          null,
          2,
        ),
      },
    ],
  };
}
