#!/bin/sh
set -eu

# Fix data directory ownership so appuser can write settings/conversations.
# Docker creates the mounted ./data dir as root at runtime; this corrects it.
chown -R appuser:appgroup /app/data

CONFIG_FILE="${FRONTEND_DIST_DIR:-/app/frontend/dist}/config.js"
API_URL="${BACKEND_HOST:-}"

cat > "$CONFIG_FILE" <<EOF
window.__LLM_COUNCIL_CONFIG__ = {
  apiUrl: "$API_URL",
};
EOF

exec gosu appuser "$@"
