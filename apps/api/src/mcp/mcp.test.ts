import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { config } from '../config.js';
import {
  createQuizzicalMcpServer,
  QUIZZICAL_MCP_TOOL_NAMES,
} from './createServer.js';
import { mcpRoutes } from './routes.js';

const TOKEN = 'test-mcp-token-for-vitest';

describe('MCP Streamable HTTP', () => {
  let savedToken: string;

  beforeEach(() => {
    savedToken = config.mcpToken;
  });

  afterEach(() => {
    config.mcpToken = savedToken;
  });

  it('does not register /mcp when MCP_TOKEN is unset', async () => {
    config.mcpToken = '';
    const app = Fastify();
    await mcpRoutes(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects missing or wrong bearer token with 401', async () => {
    config.mcpToken = TOKEN;
    const app = Fastify();
    await mcpRoutes(app);
    await app.ready();

    const noAuth = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(noAuth.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong-token',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(wrong.statusCode).toBe(401);

    await app.close();
  });

  it('accepts initialize with a valid token and exposes prep tools', async () => {
    config.mcpToken = TOKEN;
    const app = Fastify();
    await mcpRoutes(app);
    await app.ready();

    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'vitest', version: '0.0.0' },
        },
      },
    });
    expect(init.statusCode).toBe(200);
    const initBody = init.json() as {
      result?: {
        serverInfo?: { name?: string };
        capabilities?: { tools?: unknown };
      };
    };
    expect(initBody.result?.serverInfo?.name).toBe('quizzical');
    expect(initBody.result?.capabilities?.tools).toBeDefined();

    const mcp = createQuizzicalMcpServer(app);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'vitest', version: '0.0.0' });
    await mcp.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    for (const name of QUIZZICAL_MCP_TOOL_NAMES) {
      expect(names.has(name)).toBe(true);
    }
    expect(tools.length).toBe(QUIZZICAL_MCP_TOOL_NAMES.length);
    expect(names.has('upload_media')).toBe(true);

    const upload = tools.find((t) => t.name === 'upload_media');
    expect(upload?.description ?? '').toMatch(/25\s*MB/i);

    const updateQ = tools.find((t) => t.name === 'update_question');
    expect(JSON.stringify(updateQ?.inputSchema ?? {})).toMatch(/reserved/);

    const setTopic = tools.find((t) => t.name === 'set_section_topic_images');
    expect(JSON.stringify(setTopic?.inputSchema ?? {})).toMatch(/base64|mediaId/);
    const createSection = tools.find((t) => t.name === 'create_section');
    expect(JSON.stringify(createSection?.inputSchema ?? {})).toMatch(
      /topicImages/,
    );
    const setMedia = tools.find((t) => t.name === 'set_question_media');
    const replaceMedia = tools.find((t) => t.name === 'replace_question_media');
    expect(JSON.stringify(setMedia?.inputSchema ?? {})).toMatch(
      /revealImageId/,
    );
    expect(JSON.stringify(replaceMedia?.inputSchema ?? {})).toMatch(
      /reveal_image/,
    );

    await client.close();
    await mcp.close();
    await app.close();
  });

  it('exposes /mcp/health without auth when MCP is enabled', async () => {
    config.mcpToken = TOKEN;
    const app = Fastify();
    await mcpRoutes(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/mcp/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok?: boolean;
      tools?: string[];
      maxUploadBytes?: number;
    };
    expect(body.ok).toBe(true);
    expect(body.tools).toContain('upload_media');
    expect(body.maxUploadBytes).toBe(config.maxUploadBytes);

    await app.close();
  });
});
