#!/usr/bin/env bash
set -e
docker compose up -d postgres redis
echo "Waiting DB..."
sleep 3
pnpm db:generate
pnpm db:migrate || true
pnpm db:seed || true
echo "DB ready. Run: pnpm dev"
