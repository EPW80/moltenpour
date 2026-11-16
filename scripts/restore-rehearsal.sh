#!/bin/sh
# Rehearse restoring a ledger snapshot against a disposable copy, without
# touching the live ledger or its volume.
#
# The README's restore checklist, scripted: verify the snapshot, boot a server
# against a copy, mint once, and assert the new position is one past the
# snapshot's maximum. If any step fails the script exits nonzero and leaves the
# temporary copy behind for inspection.
#
#   ./scripts/restore-rehearsal.sh /path/to/snapshot.db [port]
# Port defaults to 0 (OS-assigned); an occupied explicit port is refused.
#
# Needs Go and curl. The snapshot is read-only; only the disposable copy is
# written, never the source.
set -eu
umask 077

REPO="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SNAPSHOT="${1:?usage: $0 <snapshot.db> [port]}"
PORT="${2:-0}"

command -v curl >/dev/null 2>&1 || { echo "curl not on PATH" >&2; exit 1; }

# Preserve the caller's path when the build changes into the repository.
snapshot_dir="$(CDPATH= cd -- "$(dirname -- "$SNAPSHOT")" && pwd)"
SNAPSHOT="$snapshot_dir/$(basename -- "$SNAPSHOT")"

work="$(mktemp -d)"
pid=""
cleanup() {
  status=$?
  trap - EXIT
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  if [ "$status" -eq 0 ]; then
    rm -rf "$work"
  else
    echo "restore rehearsal failed; files retained at $work" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(cd "$REPO" && go build -o "$work/server" ./api/cmd/server)
# Verify before doing anything to a copy.
"$work/server" -verify-backup "$SNAPSHOT"

copy="$work/restored.db"
cp "$SNAPSHOT" "$copy"

# The highest position the snapshot holds. The rehearsal mint must land one past
# it; anything else means the restored sequence is not continuous.
# Audit alarms do not invalidate a snapshot; its printed maximum is still valid.
max="$( "$work/server" -audit "$SNAPSHOT" | sed -n 's/^highest position  //p' )"
[ -n "$max" ] || { echo "could not read the snapshot's highest position" >&2; exit 1; }

"$work/server" -db "$copy" -addr "127.0.0.1:$PORT" >"$work/server.log" 2>&1 &
pid=$!
ready=""
for _ in $(seq 1 50); do
  kill -0 "$pid" 2>/dev/null || { cat "$work/server.log" >&2; exit 1; }
  # This line comes only from our child after a successful bind. A readiness
  # response alone could belong to another server that already occupies PORT.
  bound="$(sed -n 's/.* msg=listening addr=\([^ ]*\).*/\1/p' "$work/server.log")"
  if [ -n "$bound" ] && curl --max-time 2 -fsS -o /dev/null "http://$bound/api/ready" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.1
done
[ -n "$ready" ] && kill -0 "$pid" 2>/dev/null || { cat "$work/server.log" >&2; echo "rehearsal server did not become ready" >&2; exit 1; }

jar="$work/jar"
ts="$(date +%s)000"
body="{\"tierIndex\":0,\"timestampMs\":$ts,\"telemetry\":{\"dropletsLanded\":1,\"peakVelocity\":1,\"tiltEnergy\":0,\"holdMs\":1}}"
code="$(curl --max-time 20 -sS -b "$jar" -c "$jar" -o "$work/out.json" -w '%{http_code}' \
  -H 'content-type: application/json' -d "$body" "http://$bound/api/pours")"
[ "$code" = 201 ] || { echo "rehearsal mint returned $code: $(cat "$work/out.json")" >&2; exit 1; }

pos="$(sed -n 's/.*"ledgerPosition":\([0-9]*\).*/\1/p' "$work/out.json" | head -n 1)"
want="$((max + 1))"
[ "$pos" = "$want" ] || { echo "rehearsal minted position $pos, want $want (one past snapshot max $max)" >&2; exit 1; }

echo "restore rehearsed: minted position $pos on top of snapshot max $max"
