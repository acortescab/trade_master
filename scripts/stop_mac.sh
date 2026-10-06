#!/usr/bin/env bash
# Stop and remove the TraMa container (macOS/Linux). The trama-data volume is kept.
set -euo pipefail

CONTAINER="trama"

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  docker rm -f "$CONTAINER" >/dev/null
  echo "TraMa stopped. Data volume 'trama-data' preserved."
else
  echo "TraMa is not running."
fi
