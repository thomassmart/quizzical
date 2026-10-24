# Implementation assumptions

Recorded per the product plan. Departures from defaults are called out.

## Defaults retained

- React + TypeScript frontend (`apps/web`)
- Node.js + TypeScript backend (`apps/api`)
- PostgreSQL for durable state
- WebSockets for live updates with authenticated reconnection and snapshot resync
- Local persistent filesystem for uploaded media (PVC in OpenShift)
- External LLM via OpenAI-compatible provider adapter (LiteMaaS)
- Modular monolith (npm workspaces), not microservices
- Live gameplay independent of LLM availability

## Locked product decisions

| Item | Choice |
|------|--------|
| Project path | `~/Code/quizzical` |
| Host auth | Single password in env/Kube Secret → JWT |
| Team auth | Event code/QR + team PIN; one active answering device |
| LLM chat model | `gpt-oss-20b` (LiteMaaS / lightspeed-demo key) |
| LLM embed model | `nomic-embed-text-v1-5` (optional; may be unavailable on this key) |
| LLM fallback | `granite-3-2-8b-instruct` |
| LLM base URL | `https://maas-rhdp.apps.maas.redhatworkshops.io/v1` |
| Deploy | Helm: OpenShift Local (dev/test), single-node OpenShift (venue) |

## Explicit assumptions

1. **One concurrent live event** per deployment is enough for a 20-team venue night (single replica API + Postgres).
2. **One shared host operator** — not multi-user RBAC.
3. **Wallboard and team** use capability-scoped tokens; host routes require host JWT.
4. **Semantic similarity** is advisory for ambiguous matches; exact identity, exact-text duplicates, and reserved/used/dismissed IDs are hard blocks. Detection is not claimed to be infallible.
5. **Media** is served from the API from a local directory / PVC, not object storage.
6. **TLS** via OpenShift Routes (edge termination).
7. **ORM**: Drizzle ORM + raw SQL migrations for clarity and OpenShift-friendly migrate jobs.
8. **HTTP framework**: Fastify (TypeScript-native, good WebSocket story via `@fastify/websocket`).
9. **Local compose** is provided for Postgres; Docker may be unavailable on some developer machines — `DATABASE_URL` can point at any Postgres 15+.

## Departures from suggested defaults

1. **HTTP framework:** Fastify instead of Express for typed plugins and first-class WebSocket support. Behaviour matches the plan.
2. **Postgres UID:** The Postgres container uses UID 999 + `fsGroup` (standard image constraint). API and web containers remain unprivileged and arbitrary-UID friendly per OpenShift SCC.
