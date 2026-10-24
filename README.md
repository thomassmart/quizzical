# Quizzical

Live, in-person team trivia for venue Wi-Fi — wallboard, host console, and one answering phone per team.

## Stack

- `apps/web` — React + TypeScript (Soft Structuralism UI)
- `apps/api` — Node + Fastify + WebSockets + PostgreSQL
- `packages/shared` — scoring, state transitions, WS contracts
- `deploy/helm/quizzical` — OpenShift Local + single-node OpenShift

See [ASSUMPTIONS.md](./ASSUMPTIONS.md) and [docs/DESIGN.md](./docs/DESIGN.md).

## Local development

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ (or Podman/Docker Compose)

```bash
# Start Postgres (if Docker/Podman available)
podman compose up -d   # or: docker compose up -d

cp .env.example .env
npm install
npm run db:migrate -w @quizzical/api
npm run db:seed -w @quizzical/api
npm run dev
```

- Web: http://localhost:5173  
- API: http://localhost:4000  
- Host password: `changeme` (override with `HOST_PASSWORD`)

### Seed demo

After seed:

| Item | Value |
|------|--------|
| Event code | `DEMO01` |
| Teams | Red Pandas / `1111`, Blue Whales / `2222`, Green Lanterns / `3333` |
| Wallboard | `/wall/DEMO01?token=<printed-on-seed>` |

## Tests

```bash
npm test
```

Covers scoring matrix, transitions, structured marking, payload idempotency hashes, and role-leakage contracts.

## OpenShift

See [docs/DEPLOY.md](./docs/DEPLOY.md). Backup/restore: [docs/BACKUP.md](./docs/BACKUP.md).  
Host ops: [docs/HOST_GUIDE.md](./docs/HOST_GUIDE.md). Demo script: [docs/DEMO.md](./docs/DEMO.md). Dry-run checklist: [docs/DRY_RUN.md](./docs/DRY_RUN.md).

## LLM (optional)

LiteMaaS OpenAI-compatible API. Gameplay works with LLM unset.

```
LLM_BASE_URL=https://your-litemaas/v1
LLM_API_KEY=...
LLM_CHAT_MODEL=gpt-4o-2024-05-13
LLM_EMBED_MODEL=nomic-embed-text-v1-5
```

## MCP (optional)

Prep-only Model Context Protocol endpoint on the API. Disabled unless `MCP_TOKEN` is set.

```
MCP_TOKEN=generate-a-long-random-token
```

- URL: `http://localhost:4000/mcp` (Streamable HTTP)
- Auth: `Authorization: Bearer <MCP_TOKEN>`
- Tools: series/events/sections/questions CRUD, approve/dismiss, propose, export/import, duplicates, history, media upload / attach / replace (prompt `image`/`audio`/`video` plus answer-sheet `reveal_image` / `revealImageId`; `upload_media` max **25 MB** decoded), **writable** section Get Ready photos (`list` / `set` / `add` / `replace` / `remove` / `clear` / `refresh_section_topic_images`; `create_section.topicImages`) — no live-night controls
- Health: `GET /mcp/health` (tool list + limits; no auth) when `MCP_TOKEN` is set

Cursor MCP config example (`.cursor/mcp.json` or user MCP settings):

```json
{
  "mcpServers": {
    "quizzical": {
      "url": "http://localhost:4000/mcp",
      "headers": {
        "Authorization": "Bearer generate-a-long-random-token"
      }
    }
  }
}
```

Start the API with the same `MCP_TOKEN` value before connecting.
