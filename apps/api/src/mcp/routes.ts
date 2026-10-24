import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { config } from '../config.js';
import { mcpEnabled, verifyMcpToken } from './auth.js';
import {
  createQuizzicalMcpServer,
  QUIZZICAL_MCP_TOOL_NAMES,
} from './createServer.js';

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: 'Unauthorized' });
}

function methodNotAllowed(reply: FastifyReply) {
  return reply.code(405).send({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
}

function buildWebRequest(req: FastifyRequest): Request {
  const host = req.headers.host ?? `localhost:${config.port}`;
  const proto =
    (typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto']
      : null) ?? 'http';
  const url = `${proto}://${host}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
    init.body = JSON.stringify(req.body);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }
  return new Request(url, init);
}

async function sendWebResponse(reply: FastifyReply, response: Response) {
  reply.code(response.status);
  response.headers.forEach((value, key) => {
    // Fastify manages content-length from the body we send
    if (key.toLowerCase() === 'content-length') return;
    reply.header(key, value);
  });
  const buf = Buffer.from(await response.arrayBuffer());
  return reply.send(buf);
}

function mcpMethodName(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const m = (body as { method?: unknown }).method;
  return typeof m === 'string' ? m : undefined;
}

export async function mcpRoutes(app: FastifyInstance) {
  if (!mcpEnabled()) {
    app.log.info('MCP disabled (MCP_TOKEN unset)');
    return;
  }

  app.log.info(
    {
      toolCount: QUIZZICAL_MCP_TOOL_NAMES.length,
      tools: QUIZZICAL_MCP_TOOL_NAMES,
    },
    'MCP Streamable HTTP enabled at POST /mcp',
  );

  // Lightweight probe — no auth so load balancers / operators can see readiness.
  app.get('/mcp/health', async () => ({
    ok: true,
    transport: 'streamable-http',
    toolCount: QUIZZICAL_MCP_TOOL_NAMES.length,
    tools: [...QUIZZICAL_MCP_TOOL_NAMES],
    maxUploadBytes: config.maxUploadBytes,
    bodyLimitBytes: config.bodyLimitBytes,
    requestTimeoutMs: 300_000,
  }));

  app.post('/mcp', async (req, reply) => {
    if (!verifyMcpToken(req)) return unauthorized(reply);

    const method = mcpMethodName(req.body);
    const started = Date.now();
    const server = createQuizzicalMcpServer(app);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      const response = await Promise.race([
        transport.handleRequest(buildWebRequest(req), {
          parsedBody: req.body,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              Object.assign(new Error('MCP request timed out'), {
                code: -32001,
              }),
            );
          }, 280_000);
        }),
      ]);
      app.log.info(
        {
          mcpMethod: method,
          ms: Date.now() - started,
          status: response.status,
        },
        'mcp request ok',
      );
      return await sendWebResponse(reply, response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === 'object' && 'code' in err
          ? Number((err as { code: unknown }).code)
          : -32000;
      app.log.error(
        {
          mcpMethod: method,
          ms: Date.now() - started,
          err: message,
        },
        'mcp request failed',
      );
      return reply.code(code === -32001 ? 504 : 500).send({
        jsonrpc: '2.0',
        error: {
          code: Number.isFinite(code) ? code : -32000,
          message,
        },
        id: null,
      });
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  app.get('/mcp', async (req, reply) => {
    if (!verifyMcpToken(req)) return unauthorized(reply);
    return methodNotAllowed(reply);
  });

  app.delete('/mcp', async (req, reply) => {
    if (!verifyMcpToken(req)) return unauthorized(reply);
    return methodNotAllowed(reply);
  });
}
