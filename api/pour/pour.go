// Package pour turns a claimed pour into a minted record.
//
// The server is authoritative: it re-clamps the telemetry and recomputes the
// seed hash and the rarity rather than trusting anything the client reports. The
// client computes the same values only so its preview matches what will be
// minted.
package pour

import (
	"fmt"
	"time"

	"moltenpour/api/sigil"
)

// Record is the pour, as stored and as the certificate renders it.
//
// The JSON field names are the contract with app/pour/record.ts. Changing one
// without changing the other breaks the certificate silently — it renders with
// a zero value rather than failing.
type Record struct {
	ID string `json:"id"`
	// Who poured it. Server-side only: the client already knows it is theirs,
	// and shipping owner ids to the browser would put one visitor's identifier
	// in another's reach the moment any listing leaked.
	OwnerID        string          `json:"-"`
	LedgerPosition int             `json:"ledgerPosition"`
	TierIndex      int             `json:"tierIndex"`
	AmountCents    int             `json:"amountCents"`
	TimestampMs    int64           `json:"timestampMs"`
	Telemetry      sigil.Telemetry `json:"telemetry"`
	Violations     []string        `json:"violations"`
	Seed           uint32          `json:"seed"`
	Rarity         sigil.Rarity    `json:"rarity"`
	RarityScore    float64         `json:"rarityScore"`

	Serial    string  `json:"serial"`
	Batch     string  `json:"batch"`
	MassGrams float64 `json:"massGrams"`
	Issued    string  `json:"issued"`
}

// Request is what the client posts.
//
// TimestampMs is chosen by the CLIENT, at pour-start. That is deliberate: it
// feeds the seed hash, so a server-invented timestamp would guarantee the minted
// sigil differed from the one the user watched form. It is bounded by
// maxClockSkew below.
type Request struct {
	TierIndex   int             `json:"tierIndex"`
	TimestampMs int64           `json:"timestampMs"`
	Telemetry   sigil.Telemetry `json:"telemetry"`
}

// Prices, index-aligned with the tier table in app/ceremony/tiers.ts.
var amountCents = [6]int{0, 299, 999, 2499, 4999, 9999}

// Each landed droplet is this much metal. The certificate prints the total as
// MASS RENDERED IRRECOVERABLE.
const massPerDropletG = 3.79

// How far the client's pour-start timestamp may sit from the server's clock.
//
// A client can pick any instant inside this window and grind for a seed whose
// sigil it prefers. That is accepted: rarity is a pure function of the clamped
// telemetry and the tier and does not read the hash at all, so grinding changes
// only which splatter you get, never how rare it is. The window exists to stop a
// replayed or far-future timestamp, not to stop that.
const maxClockSkew = 5 * time.Minute

// Mint validates, clamps, and derives everything the certificate prints.
//
// ledgerPosition is supplied by the store, which owns ordering. ownerID comes
// from the session, never from the request body — a client that could name its
// own owner could mint into someone else's collection.
func Mint(req Request, ledgerPosition int, ownerID string, now time.Time) (Record, error) {
	if req.TierIndex < 0 || req.TierIndex >= len(amountCents) {
		return Record{}, fmt.Errorf("tierIndex %d out of range", req.TierIndex)
	}

	nowMs := now.UnixMilli()
	skewMs := maxClockSkew.Milliseconds()
	if req.TimestampMs < nowMs-skewMs || req.TimestampMs > nowMs+skewMs {
		return Record{}, fmt.Errorf("timestampMs %d outside the accepted window", req.TimestampMs)
	}

	// The wall clock the client had available: pour-start to now. A pour cannot
	// outlast it, which is what stops a client claiming a 15-second hold on a
	// request it sent two seconds after starting.
	wallClockMs := float64(nowMs - req.TimestampMs)
	if wallClockMs < 0 {
		wallClockMs = 0
	}

	clamped := sigil.ClampTelemetry(req.Telemetry, req.TierIndex, wallClockMs)

	seed := sigil.HashSeed(sigil.BurnSeed{
		TierIndex:   req.TierIndex,
		AmountCents: amountCents[req.TierIndex],
		TimestampMs: req.TimestampMs,
		Telemetry:   clamped.Telemetry,
	})

	violations := clamped.Violations
	if violations == nil {
		// [] rather than null: the client iterates this, and a JSON null there is
		// the same distinction that cost a cycle in the Go port's first test run.
		violations = []string{}
	}

	return Record{
		ID:             fmt.Sprintf("%08x-%d", seed, ledgerPosition),
		OwnerID:        ownerID,
		LedgerPosition: ledgerPosition,
		TierIndex:      req.TierIndex,
		AmountCents:    amountCents[req.TierIndex],
		TimestampMs:    req.TimestampMs,
		Telemetry:      clamped.Telemetry,
		Violations:     violations,
		Seed:           seed,
		Rarity:         sigil.Classify(clamped.Telemetry, req.TierIndex),
		RarityScore:    sigil.RarityScore(clamped.Telemetry, req.TierIndex),

		Serial:    fmt.Sprintf("MP-%07d-%04X", ledgerPosition, seed&0xFFFF),
		Batch:     fmt.Sprintf("%03d-%c", ledgerPosition%1000, 'A'+rune(seed%26)),
		MassGrams: clamped.Telemetry.DropletsLanded * massPerDropletG,
		// ISO YYYY-MM-DD, never localized — the deadpan register depends on it.
		Issued: now.UTC().Format("2006-01-02"),
	}, nil
}
