#!/usr/bin/env bash
# Brings the control room up, or catches a running one up with the code. Safe to re-run.
#   scripts/start.sh            install, services, schema, seed if empty, dev server if not running
#   scripts/start.sh --restart  same, but restarts the dev server
#   scripts/start.sh --clean    restarts with an empty .next cache (fixes a page stuck reloading after a big merge)
# The dev server logs to /tmp/next-dev.log.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
LOG=/tmp/next-dev.log
restart=false
clean=false
case "${1:-}" in
  --restart) restart=true ;;
  --clean) restart=true; clean=true ;;
esac

step() { printf '\n==> %s\n' "$*"; }

step "Environment"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Set OPENROUTER_API_KEY in it for the reviewer and voice agent."
fi

step "Dependencies"
if [[ ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
  npm ci
else
  echo "Up to date."
fi

step "Postgres and object store"
docker compose up -d --wait

step "Schema"
# No TTY: drizzle-kit fails instead of waiting on a data-loss prompt, so a destructive change stops here.
npm run --silent db:push </dev/null

step "Snapshot"
orders=$(docker compose exec -T db psql -U controlroom -d controlroom -tAc "select count(*) from orders")
if [[ "$orders" == "0" ]]; then
  npm run db:seed
else
  echo "$orders orders already seeded. Run npm run db:seed to reset the snapshot."
fi

step "Attachments"
npm run --silent attachments:seed

step "Dev server"
pids=$(pgrep -f "next dev|next-server" || true)
if [[ -n "$pids" && "$restart" == true ]]; then
  echo "Stopping $pids"
  kill $pids
  while pgrep -f "next dev|next-server" >/dev/null; do sleep 0.5; done
  pids=""
fi
if [[ "$clean" == true ]]; then
  rm -rf .next
  echo "Cleared .next"
fi
if [[ -z "$pids" ]]; then
  setsid nohup npm run dev -- --port "$PORT" >"$LOG" 2>&1 </dev/null &
  echo "Started on :$PORT, logging to $LOG"
else
  echo "Already running. Use --restart to restart it."
fi

step "Health"
for _ in $(seq 1 60); do
  # /api/clock reads the engine tables, so a 200 means the schema and the server both work.
  code=$(curl -s -o /dev/null -w '%{http_code}' -b persona=operator "http://localhost:$PORT/api/clock" || true)
  if [[ "$code" == "200" ]]; then
    echo "Ready at http://localhost:$PORT"
    exit 0
  fi
  sleep 1
done
echo "No healthy answer after 60s (last status $code). Last log lines:"
tail -20 "$LOG"
exit 1
