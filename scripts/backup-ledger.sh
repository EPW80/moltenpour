#!/bin/sh
# Pull the live ledger off the Fly volume.
#
# The ledger is the one thing in this deployment that cannot be rebuilt. A
# sigil re-mints from its seed, the app rebuilds from source, but a pour's
# ledger position and serial exist only in moltenpour.db — losing it re-issues
# No. 1 to somebody, on a document whose whole register is institutional
# permanence.
#
# Fly's volume snapshots (fly.toml, snapshot_retention) are the automatic
# floor. This is the other layer: a copy that survives losing the volume, the
# region, or the Fly account itself. Run it somewhere that is itself backed up.
#
#   ./scripts/backup-ledger.sh                 # -> backups/<utc-timestamp>/
#   ./scripts/backup-ledger.sh /mnt/archive    # -> /mnt/archive/<utc-timestamp>/
#
# The image is distroless and has no shell, so `fly ssh console` gives you
# nothing to type into. `fly ssh sftp` works anyway: it is served by Fly's init,
# not by anything in the image.

set -eu

APP="${FLY_APP:-$(sed -n 's/^app = "\(.*\)"$/\1/p' "$(dirname "$0")/../fly.toml")}"
DEST_ROOT="${1:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$DEST_ROOT/$STAMP"

command -v fly >/dev/null 2>&1 || { echo "flyctl not on PATH" >&2; exit 1; }
[ -n "$APP" ] || { echo "could not read the app name from fly.toml; set FLY_APP" >&2; exit 1; }

mkdir -p "$DEST"
echo "backing up $APP -> $DEST"

# All three files, not just the .db. SQLite runs in WAL mode (api/pour/sqlite.go),
# so commits live in moltenpour.db-wal until a checkpoint folds them in. A .db
# copied alone is a valid database that is silently missing the most recent
# pours — the worst failure shape available here, because it restores cleanly.
#
# -shm is rebuildable and only copied so a restore starts from a coherent set.
# The .db itself is required; the other two may legitimately be absent if the
# machine checkpointed and closed cleanly.
for f in moltenpour.db moltenpour.db-wal moltenpour.db-shm; do
  if fly ssh sftp get "/data/$f" "$DEST/$f" --app "$APP" 2>/dev/null; then
    echo "  $f  $(wc -c < "$DEST/$f") bytes"
  elif [ "$f" = moltenpour.db ]; then
    echo "could not fetch /data/$f — is the machine running? (fly status)" >&2
    exit 1
  else
    echo "  $f  absent (checkpointed)"
  fi
done

# This copy is taken from a running server, so it is a hot copy: consistent
# enough for SQLite to recover from on open, not a guaranteed quiesced point.
# Verify it before you need it, by opening it rather than by trusting the sizes:
#
#   go run ./api/cmd/server -db "$DEST/moltenpour.db" -addr :8788
#   curl -s localhost:8788/api/pours
#
# For a point-in-time copy with no writer at all, use a volume snapshot
# (fly volumes snapshots list) instead.
echo "done. verify with: go run ./api/cmd/server -db $DEST/moltenpour.db -addr :8788"
