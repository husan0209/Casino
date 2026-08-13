#!/usr/bin/env bash
set -e

echo "Starting rollback..."

# Assuming a blue-green or simple git-based deployment
# Find the previous commit deployed
PREVIOUS_COMMIT=$(git rev-parse HEAD~1)

echo "Rolling back to $PREVIOUS_COMMIT"
git checkout $PREVIOUS_COMMIT

echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Rebuilding API..."
pnpm build:api

echo "Restarting services..."
pm2 reload api || docker-compose restart api

echo "Running health check..."
./infra/scripts/health-check.sh

echo "Rollback successful."
