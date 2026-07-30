#!/bin/bash
# Start Sleiz Studio dev servers (web + api) fully detached so they survive
# the parent bash session ending. Logs go to logs/api.log and logs/web.log.

set -e
cd /home/z/my-project
mkdir -p logs

# Kill anything still bound to 3000 / 8787
bun run scripts/kill-port.ts 3000 8787 2>/dev/null || true

# IMPORTANT: unset any shell-level DATABASE_URL / STORAGE_DIR so Bun loads
# them fresh from the project's .env file. Without this, a stale value
# from a previous session (or from the sandbox's initial setup) will
# override .env and cause the API to open the wrong SQLite file.
unset DATABASE_URL STORAGE_DIR

# Start API server (Hono on :8787) — fully detached via setsid + nohup.
# We use --hot only in dev for auto-reload on file changes.
setsid nohup env -u DATABASE_URL -u STORAGE_DIR \
  bun --preload ./packages/api/src/bun-patches.ts --hot ./packages/api/src/server.ts \
  < /dev/null > logs/api.log 2>&1 &
disown 2>/dev/null || true

# Give API a moment to bind before web starts pinging it
sleep 3

# Start Vite web (port 3000) — fully detached
cd /home/z/my-project/apps/web
setsid nohup env -u DATABASE_URL -u STORAGE_DIR \
  bun x vite --port 3000 --host \
  < /dev/null > /home/z/my-project/logs/web.log 2>&1 &
disown 2>/dev/null || true

cd /home/z/my-project
echo "Started Sleiz Studio dev servers (detached)."
echo "  Web: http://localhost:3000  (log: logs/web.log)"
echo "  API: http://localhost:8787  (log: logs/api.log)"

# Wait briefly so logs have something to tail
sleep 6
echo "--- api.log tail ---"
tail -15 logs/api.log || true
echo "--- web.log tail ---"
tail -10 logs/web.log || true
