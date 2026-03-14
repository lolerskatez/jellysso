#!/bin/bash
# Generates a .env file from .env.example with random secrets pre-filled.
# Run once before starting JellySSO:  bash generate-env.sh

set -e

ENV_FILE=".env"
EXAMPLE_FILE=".env.example"

if [ -f "$ENV_FILE" ]; then
  echo "⚠️  .env already exists — not overwriting."
  echo "   Delete it first if you want to regenerate secrets."
  exit 0
fi

if [ ! -f "$EXAMPLE_FILE" ]; then
  echo "❌ .env.example not found."
  exit 1
fi

# Check openssl is available
if ! command -v openssl &>/dev/null; then
  echo "❌ openssl not found. Install it and try again."
  exit 1
fi

SESSION_SECRET=$(openssl rand -hex 32)
SHARED_SECRET=$(openssl rand -hex 32)
COOKIE_SECRET=$(openssl rand -hex 32)

sed \
  -e "s|^SESSION_SECRET=\s*$|SESSION_SECRET=${SESSION_SECRET}|" \
  -e "s|^SHARED_SECRET=\s*$|SHARED_SECRET=${SHARED_SECRET}|" \
  -e "s|^COOKIE_SECRET=\s*$|COOKIE_SECRET=${COOKIE_SECRET}|" \
  "$EXAMPLE_FILE" > "$ENV_FILE"

echo "✅ .env created with generated secrets:"
echo "   SESSION_SECRET — generated"
echo "   SHARED_SECRET  — generated"
echo "   COOKIE_SECRET  — generated"
echo ""
echo "Next steps:"
echo "  1. Review .env — set APP_PORT or PUBLIC_URL if needed"
echo "  2. docker-compose up -d"
echo "  3. Open http://localhost:3010/setup to connect Jellyfin"
