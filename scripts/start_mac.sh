#!/usr/bin/env bash
# Start the TraMa container (macOS/Linux). Idempotent: safe to run repeatedly.
#
# Usage: scripts/start_mac.sh [--build] [--mock] [--no-open]
#   --build    Rebuild the Docker image even if it already exists
#   --mock     Run with LLM_MOCK=true (deterministic chat responses, used by E2E tests)
#   --no-open  Don't open the browser
set -euo pipefail

IMAGE="trama"
CONTAINER="trama"
VOLUME="trama-data"
PORT="${TRAMA_PORT:-8000}"
URL="http://localhost:${PORT}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BUILD=0
MOCK=0
OPEN=1
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    --mock) MOCK=1 ;;
    --no-open) OPEN=0 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker is not running. Start Docker and try again." >&2
  exit 1
fi

if [[ "$BUILD" -eq 1 ]] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Building image '$IMAGE'..."
  docker build -t "$IMAGE" .
fi

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "Removing existing container '$CONTAINER'..."
  docker rm -f "$CONTAINER" >/dev/null
fi

RUN_ARGS=(-d --name "$CONTAINER" -v "$VOLUME:/app/db" -p "$PORT:8000")
if [[ -f .env ]]; then
  RUN_ARGS+=(--env-file .env)
elif [[ -f .env.example ]]; then
  echo "Warning: .env not found; using .env.example (AI chat will be unavailable without OPENROUTER_API_KEY)." >&2
  RUN_ARGS+=(--env-file .env.example)
else
  echo "Warning: no .env or .env.example found; starting with defaults." >&2
fi
# Explicit -e values override anything in the env file
RUN_ARGS+=(-e DB_PATH=/app/db/trama.db -e STATIC_DIR=/app/static)
if [[ "$MOCK" -eq 1 ]]; then
  RUN_ARGS+=(-e LLM_MOCK=true)
fi

docker run "${RUN_ARGS[@]}" "$IMAGE" >/dev/null

echo -n "Waiting for TraMa to become healthy"
HEALTHY=0
for _ in $(seq 1 30); do
  if curl -fsS "$URL/api/health" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  echo -n "."
  sleep 1
done
echo
if [[ "$HEALTHY" -eq 0 ]]; then
  echo "Warning: health check did not pass yet; see 'docker logs $CONTAINER'." >&2
fi

echo "TraMa is running at $URL"
if [[ "$MOCK" -eq 1 ]]; then
  echo "(LLM mock mode enabled)"
fi

if [[ "$OPEN" -eq 1 ]]; then
  if command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  fi
fi
