#!/bin/sh
# Live smoke test: the real server binary, over real HTTP, with a cookie jar.
#
# The Go and TypeScript suites each test one side of the API in-process. What
# neither exercises is the built binary answering a browser-shaped client: the
# readiness gate, the owner cookie round-tripping, and a mint that is replayed.
#
#   ./scripts/smoke.sh                       # builds and starts its own server
#   ./scripts/smoke.sh http://127.0.0.1:8787 # checks one that is already running
#
# With no argument it serves an in-memory ledger on :8791 and stops it on exit,
# so it never touches moltenpour.db. Needs go and curl.
set -eu

fail() { echo "smoke: FAIL: $*" >&2; exit 1; }

# Field extraction without jq, so the script runs on a bare machine. The
# records are flat enough for it: "id" and "ledgerPosition" are top-level and
# appear once per record.
str() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$2" | head -n 1; }
num() { sed -n "s/.*\"$1\":\([0-9]*\).*/\1/p" "$2" | head -n 1; }

dir="$(mktemp -d)"
pid=""
cleanup() {
  [ -n "$pid" ] && kill "$pid" 2>/dev/null && wait "$pid" 2>/dev/null || true
  rm -rf "$dir"
}
trap cleanup EXIT

base="${1:-}"
if [ -z "$base" ]; then
  base="http://127.0.0.1:8791"
  (cd api && go build -o "$dir/server" ./cmd/server)
  "$dir/server" -addr 127.0.0.1:8791 -db :memory: >"$dir/server.log" 2>&1 &
  pid=$!
fi

# /api/ready asks the ledger, so a 200 here means the store opened and can be read.
ready=""
for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "$base/api/ready" 2>/dev/null; then ready=1; break; fi
  [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null && { cat "$dir/server.log" >&2; fail "server exited before it was ready"; }
  sleep 0.2
done
[ -n "$ready" ] || { [ -f "$dir/server.log" ] && cat "$dir/server.log" >&2; fail "/api/ready never answered 200"; }
echo "smoke: ready"

jar="$dir/jar"
ts="$(date +%s)000"
body="{\"tierIndex\":0,\"timestampMs\":$ts,\"telemetry\":{\"dropletsLanded\":20,\"peakVelocity\":100,\"tiltEnergy\":5,\"holdMs\":3000}}"

mint() {
  curl -sS -b "$jar" -c "$jar" -o "$dir/out.json" -w '%{http_code}' \
    -H 'content-type: application/json' -d "$body" "$base/api/pours"
}

code="$(mint)"
[ "$code" = 201 ] || fail "first mint returned $code, expected 201: $(cat "$dir/out.json")"
id="$(str id "$dir/out.json")"
pos="$(num ledgerPosition "$dir/out.json")"
[ -n "$id" ] && [ "$id" != null ] || fail "the minted record has no id"
echo "smoke: minted $id at position $pos"

# The same body again is a retry whose first answer was lost. It must return the
# stored record, not take a second ledger position.
code="$(mint)"
[ "$code" = 200 ] || fail "replayed mint returned $code, expected 200"
[ "$(str id "$dir/out.json")" = "$id" ] || fail "the replay returned a different id"
[ "$(num ledgerPosition "$dir/out.json")" = "$pos" ] || fail "the replay took a new ledger position"
echo "smoke: replay returned the same record"

curl -fsS -b "$jar" "$base/api/pours" >"$dir/list.json" || fail "listing failed"
n="$(grep -o '"ledgerPosition"' "$dir/list.json" | wc -l | tr -d ' ')"
[ "$n" = 1 ] || fail "listing holds $n pours, expected 1"
[ "$(str id "$dir/list.json")" = "$id" ] || fail "the listing does not hold the minted pour"
echo "smoke: listed"

curl -fsS -b "$jar" "$base/api/pours/$id" >"$dir/get.json" || fail "get failed"
[ "$(str id "$dir/get.json")" = "$id" ] || fail "get returned a different pour"
echo "smoke: fetched"

# Owner-scoped: a client with no cookie must not see the pour.
code="$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/pours/$id")"
[ "$code" = 404 ] || fail "a stranger got $code for someone else's pour, expected 404"
echo "smoke: owner-scoped"

echo "smoke: ok"
