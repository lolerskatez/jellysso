#!/bin/sh
# docker-entrypoint.sh
# Validates required environment variables before starting the application.

set -e

RED='\033[0;31m'
NC='\033[0m'

MISSING=0

check_required() {
  VAR_NAME="$1"
  VAR_VALUE="$2"
  if [ -z "$VAR_VALUE" ]; then
    echo "${RED}❌ Required environment variable $VAR_NAME is not set.${NC}"
    MISSING=1
  fi
}

check_required "SESSION_SECRET" "$SESSION_SECRET"
check_required "SHARED_SECRET"  "$SHARED_SECRET"
check_required "COOKIE_SECRET"  "$COOKIE_SECRET"

if [ "$MISSING" = "1" ]; then
  echo ""
  echo "Generate a .env file with secrets before starting:"
  echo "  bash generate-env.sh        # Linux / macOS"
  echo "  node generate-env.js        # Windows (requires Node)"
  echo ""
  echo "Then restart: docker-compose up -d"
  exit 1
fi

exec "$@"
