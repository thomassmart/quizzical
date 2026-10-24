# Deploy Quizzical on OpenShift

Single-instance deployment sized for ~20 teams.

## Local Podman (available now)

OpenShift Local (`crc`) is **not installed** on this machine, and existing `oc` contexts are unreachable from the current network. Use Podman Compose for local run; switch to CRC when installed.

```bash
cd ~/Code/quizzical
# .env already holds LiteMaaS URL/key/models (gitignored)
podman compose up -d --build
# Web UI: http://localhost:9080
# API:    http://localhost:4000
```

Seed (once Postgres is up):

```bash
npm run db:migrate -w @quizzical/api
npm run db:seed -w @quizzical/api
```

### OpenShift Local install (when ready)

1. Install from https://console.redhat.com/openshift/create/local (needs Red Hat login + pull secret).
2. Save pull secret as `~/pull-secret`.
3. Run `./scripts/setup-openshift-local.sh` (needs ~9GB RAM free; this Mac has 16GB total so quit heavy apps first).

Note: Homebrew no longer ships a `crc` cask — use the Red Hat installer.

## Build images

### GitHub Actions → GHCR (preferred)

Push to `main`/`master` (or a `v*` tag), or run **Publish containers** manually. Images:

- `ghcr.io/<owner>/quizzical-api:<tag>`
- `ghcr.io/<owner>/quizzical-web:<tag>`

Tags include `latest` (default branch), branch name, short SHA (`sha-…`), and semver for version tags.

Packages are private by default under the GitHub org/user. For OpenShift pulls:

```bash
# PAT needs read:packages (and SSO authorize if the org requires it)
oc create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USER \
  --docker-password=YOUR_GITHUB_PAT \
  --docker-email=you@example.com \
  -n quizzical
```

### Local Podman build

```bash
podman build -f apps/api/Containerfile -t quizzical-api:latest .
podman build -f apps/web/Containerfile -t quizzical-web:latest .
```

## OpenShift from GHCR (home-hosting / SNO)

API applies DB migrations on boot (and Helm still runs a migrate Job). `/readyz` returns 503 if migrations are pending.

```bash
oc new-project quizzical   # if needed

# Edit OWNER in values, or pass --set:
helm upgrade --install quizzical deploy/helm/quizzical \
  -f deploy/helm/quizzical/values/home-hosting.yaml \
  --set image.api=ghcr.io/OWNER/quizzical-api:latest \
  --set image.web=ghcr.io/OWNER/quizzical-web:latest \
  --set imagePullSecrets[0].name=ghcr-pull \
  --set hostPassword='your-host-password' \
  --set jwtSecret='long-random-string' \
  --set mcpToken='long-random-mcp-token' \
  --set route.host=quizzical.apps.home-hosting.mts.id.au \
  --set llm.baseUrl='https://maas-.../v1' \
  --set llm.apiKey='sk-...'

oc rollout status deploy/quizzical-api
oc rollout status deploy/quizzical-web
curl -fsS https://quizzical.apps.home-hosting.mts.id.au/readyz
curl -fsS https://quizzical.apps.home-hosting.mts.id.au/mcp/health
```

Upload limits: nginx `client_max_body_size` 35m, API decoded media max **25 MB** (documented on MCP `upload_media`).

## OpenShift Local (CRC)

```bash
oc new-project quizzical
helm upgrade --install quizzical deploy/helm/quizzical \
  -f deploy/helm/quizzical/values/openshift-local.yaml \
  --set image.api=quizzical-api:latest \
  --set image.web=quizzical-web:latest \
  --set hostPassword='your-host-password' \
  --set jwtSecret='long-random-string' \
  --set route.host=quizzical-quizzical.apps-crc.testing \
  --set llm.baseUrl='https://maas-.../v1' \
  --set llm.apiKey='sk-...'
```

## Single-node OpenShift (venue)

```bash
oc new-project quizzical
helm upgrade --install quizzical deploy/helm/quizzical \
  -f deploy/helm/quizzical/values/sno-production.yaml \
  --set image.api=ghcr.io/OWNER/quizzical-api:latest \
  --set image.web=ghcr.io/OWNER/quizzical-web:latest \
  --set imagePullSecrets[0].name=ghcr-pull \
  --set hostPassword='...' \
  --set jwtSecret='...' \
  --set route.host=quizzical.apps.your-sno.example \
  --set llm.baseUrl='...' \
  --set llm.apiKey='...'
```

## Venue networking

1. **Wi-Fi** — Phones and wallboard PC on the same LAN path to the OpenShift router (or Podman host).
2. **DNS** — Point a local name at the router VIP, or use the default apps domain.
3. **WEB_ORIGIN** — Must be the URL phones open (LAN hostname), so join QR codes work.
4. **Media** — Snapshots emit root-relative `/media/…` URLs; the web proxy must forward `/media` and `/api` to the API (compose nginx already does). `PUBLIC_BASE_URL` is not required for client media loads.
5. **TLS** — Route uses edge termination. Trust the cluster CA on devices, or use a public cert.
6. **LLM egress** — API pods need outbound HTTPS to LiteMaaS. If egress fails, generation/marking suggestions degrade; answering and timers continue.
7. **Resources** — Chart defaults assume one API replica; do not scale API horizontally without sticky sessions / shared state work.

## Security notes

- Containers are unprivileged and arbitrary-UID friendly (`runAsNonRoot`, drop ALL caps).
- Host password, JWT secret, and LLM key live in a Secret.
- Team PINs are bcrypt-hashed; never shown on the wallboard.
- Uploads: images/audio/video, **25 MB** decoded max (nginx/JSON body ~35m for base64).
