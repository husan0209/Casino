#!/usr/bin/env bash
set -e

API_URL="http://localhost:3001/api/v1/health"
MAX_ATTEMPTS=5
SLEEP_TIME=5

echo "Checking health at $API_URL..."

for (( i=1; i<=$MAX_ATTEMPTS; i++ ))
do
  STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL" || true)
  if [ "$STATUS_CODE" == "200" ]; then
    echo "Health check passed!"
    
    # Optionally verify DB connectivity from the health endpoint output
    RESPONSE=$(curl -s "$API_URL")
    if echo "$RESPONSE" | grep -q '"status":"ok"'; then
       echo "Database is connected."
       exit 0
    fi
  fi
  
  echo "Attempt $i failed (Status: $STATUS_CODE). Retrying in $SLEEP_TIME seconds..."
  sleep $SLEEP_TIME
done

echo "Health check failed after $MAX_ATTEMPTS attempts."
exit 1
