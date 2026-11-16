#!/bin/sh
# Audit the escalation triggers on a ledger without starting the server.
#
# The server logs the raw signals (overclaims, rarity) on every mint; this
# aggregates them into the two rates app/sigil/telemetry.ts says to escalate on,
# and exits nonzero if either has crossed its threshold:
#
#   - telemetry overclaims on more than 2% of pours
#   - Singular share on tiers 3-5 above twice the corpus's modeled rate
#
#   ./scripts/ledger-audit.sh                 # audits ./moltenpour.db
#   ./scripts/ledger-audit.sh /path/to/ledger.db
#
# Read-only: never runs the server, never writes the ledger. Needs Go.
set -eu

REPO="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
DB="${1:-moltenpour.db}"

if [ ! -f "$DB" ]; then
  echo "ledger-audit: $DB does not exist" >&2
  exit 1
fi

(cd "$REPO" && go run ./api/cmd/server -audit "$DB")