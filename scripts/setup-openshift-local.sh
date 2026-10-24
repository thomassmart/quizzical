#!/usr/bin/env bash
# Install and start OpenShift Local (CRC), then deploy Quizzical.
# Requires a Red Hat pull secret from https://console.redhat.com/openshift/create/local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PULL_SECRET="${CRC_PULL_SECRET:-$HOME/pull-secret}"
CRC_BIN="${CRC_BIN:-}"

if ! command -v crc >/dev/null 2>&1 && [[ -z "$CRC_BIN" ]]; then
  echo "OpenShift Local (crc) is not installed."
  echo "Download the macOS installer from:"
  echo "  https://console.redhat.com/openshift/create/local"
  echo "Or place the crc binary on PATH, then re-run this script."
  echo
  echo "Meanwhile the Podman stack is the supported local path:"
  echo "  cd $ROOT && podman compose up -d --build"
  exit 1
fi

CRC_BIN="${CRC_BIN:-$(command -v crc)}"

if [[ ! -f "$PULL_SECRET" ]]; then
  echo "Missing pull secret at $PULL_SECRET"
  echo "Download from https://console.redhat.com/openshift/create/local"
  echo "and save as ~/pull-secret (or set CRC_PULL_SECRET)."
  exit 1
fi

"$CRC_BIN" setup
"$CRC_BIN" config set memory 9216
"$CRC_BIN" config set cpus 4
"$CRC_BIN" config set pull-secret-file "$PULL_SECRET"
"$CRC_BIN" start

eval "$("$CRC_BIN" oc-env)"
oc login -u kubeadmin -p "$("$CRC_BIN" console --credentials | awk '/kubeadmin/ {print $NF}')" >/dev/null 2>&1 || true

oc new-project quizzical 2>/dev/null || oc project quizzical

# Build into the CRC internal registry via podman
HOST="$("$CRC_BIN" console --url | sed -E 's#https://console-openshift-console\.(.*)#apps.\1#')"
# Prefer apps-crc.testing style host
ROUTE_HOST="quizzical-quizzical.apps-crc.testing"

echo "Building images with podman..."
cd "$ROOT"
podman build -f apps/api/Containerfile -t quizzical-api:latest .
podman build -f apps/web/Containerfile -t quizzical-web:latest .

# Load into CRC (requires crc image mirror / docker push to default route)
# For CRC, tag into the integrated registry after oc login:
REGISTRY="$(oc registry info)"
oc registry login
podman tag quizzical-api:latest "$REGISTRY/quizzical/api:latest"
podman tag quizzical-web:latest "$REGISTRY/quizzical/web:latest"
podman push "$REGISTRY/quizzical/api:latest"
podman push "$REGISTRY/quizzical/web:latest"

# shellcheck disable=SC1091
set -a
# Load LLM secrets from .env if present (do not commit)
[[ -f "$ROOT/.env" ]] && source "$ROOT/.env"
set +a

helm upgrade --install quizzical "$ROOT/deploy/helm/quizzical" \
  -f "$ROOT/deploy/helm/quizzical/values/openshift-local.yaml" \
  --set image.api="$REGISTRY/quizzical/api:latest" \
  --set image.web="$REGISTRY/quizzical/web:latest" \
  --set hostPassword="${HOST_PASSWORD:-changeme}" \
  --set jwtSecret="${JWT_SECRET:-crc-jwt-$(openssl rand -hex 16)}" \
  --set route.host="$ROUTE_HOST" \
  --set llm.baseUrl="${LLM_BASE_URL}" \
  --set llm.apiKey="${LLM_API_KEY}" \
  --set llm.chatModel="${LLM_CHAT_MODEL:-gpt-oss-20b}" \
  --set llm.fallbackChatModel="${LLM_FALLBACK_CHAT_MODEL:-granite-3-2-8b-instruct}"

echo "Deployed. Route: https://$ROUTE_HOST"
oc get pods,route -n quizzical
