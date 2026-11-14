#!/bin/sh
# Export one consistent SQLite snapshot, download it, and verify it locally.
# Requires flyctl, jq, Go, and the deployed server's backup CLI.
# Failed exports/downloads are retained for diagnosis. Remote snapshots live in
# /tmp until machine replacement; periodically remove old copies through SFTP.
set -eu
umask 077

APP="${FLY_APP:-$(sed -n 's/^app = "\(.*\)"$/\1/p' "$(dirname "$0")/../fly.toml")}"
DEST_ROOT="${1:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
DEST="$DEST_ROOT/$STAMP"
REMOTE="/tmp/moltenpour-backup-$STAMP.db"
REPO="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

for tool in fly jq go; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool not on PATH" >&2; exit 1; }
done
[ -n "$APP" ] || { echo "set FLY_APP or configure fly.toml" >&2; exit 1; }
MACHINES="$(fly machines list --app "$APP" --json)"
MACHINE="$(printf '%s' "$MACHINES" | jq -er 'if length == 1 and .[0].state == "started" then .[0].id else error("expected exactly one started machine") end')"
mkdir -p "$DEST"
DEST_ABSOLUTE="$(CDPATH= cd -- "$DEST" && pwd)/moltenpour.db"
echo "backing up $APP -> $DEST"
fly ssh console --app "$APP" --machine "$MACHINE" --command "/usr/local/bin/server -db /data/moltenpour.db -backup $REMOTE"
fly ssh sftp get "$REMOTE" "$DEST/moltenpour.db" --app "$APP" --machine "$MACHINE"
(cd "$REPO" && go run ./api/cmd/server -verify-backup "$DEST_ABSOLUTE")
echo "verified snapshot: $DEST/moltenpour.db"
