package pour

import (
	"strings"
	"sync"
	"testing"
	"time"

	"moltenpour/api/sigil"
)

var when = time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)

func req(tier int, t sigil.Telemetry) Request {
	return Request{TierIndex: tier, TimestampMs: when.UnixMilli(), Telemetry: t}
}

func honest() sigil.Telemetry {
	return sigil.Telemetry{DropletsLanded: 60, PeakVelocity: 1400, TiltEnergy: 9, HoldMs: 4000}
}

// The property the whole cross-language pipeline exists to protect: the seed the
// server mints is the seed the client previewed. Here that means Mint's seed is
// exactly HashSeed over the clamped telemetry, with no server-side substitution
// of the timestamp or the amount.
func TestMintSeedMatchesHashOfClampedTelemetry(t *testing.T) {
	// A late request, so the clamp actually bites and the raw and clamped
	// telemetry differ — otherwise this passes for the wrong reason.
	later := when.Add(2 * time.Second)
	rec, err := Mint(req(3, sigil.Telemetry{DropletsLanded: 9e9, PeakVelocity: 9e9, TiltEnergy: 9e9, HoldMs: 9e9}), 1, later)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Telemetry == (sigil.Telemetry{DropletsLanded: 9e9, PeakVelocity: 9e9, TiltEnergy: 9e9, HoldMs: 9e9}) {
		t.Fatal("clamp did not bite; test proves nothing")
	}

	want := sigil.HashSeed(sigil.BurnSeed{
		TierIndex:   rec.TierIndex,
		AmountCents: rec.AmountCents,
		TimestampMs: rec.TimestampMs,
		Telemetry:   rec.Telemetry,
	})
	if rec.Seed != want {
		t.Fatalf("seed %d is not the hash of the stored record (%d)", rec.Seed, want)
	}
}

// A pour cannot outlast the wall clock the client actually had. Without this the
// clamp's holdMs ceiling is whatever the client says it is.
func TestHoldIsBoundedByServerMeasuredWallClock(t *testing.T) {
	// Claims a full 15s pour two seconds after starting.
	rec, err := Mint(req(5, sigil.Telemetry{DropletsLanded: 500, PeakVelocity: 2000, TiltEnergy: 90, HoldMs: 15000}), 1, when.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if rec.Telemetry.HoldMs > 2000 {
		t.Fatalf("holdMs %v exceeds the 2000ms the client actually had", rec.Telemetry.HoldMs)
	}
	if len(rec.Violations) == 0 {
		t.Fatal("claiming 15s of pour in 2s should be recorded as an overclaim")
	}
}

func TestRejectsTimestampOutsideWindow(t *testing.T) {
	for _, tc := range []struct {
		name string
		ts   time.Time
	}{
		{"far future", when.Add(2 * time.Hour)},
		{"stale replay", when.Add(-2 * time.Hour)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := req(2, honest())
			r.TimestampMs = tc.ts.UnixMilli()
			if _, err := Mint(r, 1, when); err == nil {
				t.Fatal("expected rejection")
			}
		})
	}
}

func TestRejectsOutOfRangeTier(t *testing.T) {
	for _, tier := range []int{-1, 6, 99} {
		if _, err := Mint(req(tier, honest()), 1, when); err == nil {
			t.Fatalf("tier %d should be rejected", tier)
		}
	}
}

// The certificate prints these verbatim, so their shape is part of the design.
func TestDerivedStringsMatchTheCertificateFormat(t *testing.T) {
	rec, err := Mint(req(3, honest()), 1284, when)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(rec.Serial, "MP-0001284-") || len(rec.Serial) != len("MP-0001284-6AE8") {
		t.Fatalf("serial %q does not match MP-0001284-XXXX", rec.Serial)
	}
	if rec.Issued != "2026-08-02" {
		t.Fatalf("issued %q is not ISO YYYY-MM-DD", rec.Issued)
	}
	if len(rec.Batch) != 5 || rec.Batch[3] != '-' {
		t.Fatalf("batch %q does not match NNN-X", rec.Batch)
	}
	if rec.AmountCents != 2499 {
		t.Fatalf("tier 3 should cost 2499, got %d", rec.AmountCents)
	}
}

// Violations is iterated by the client. A JSON null there is the same nil-vs-empty
// distinction that cost a cycle in the original Go port.
func TestViolationsIsNeverNil(t *testing.T) {
	rec, err := Mint(req(2, honest()), 1, when)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Violations == nil {
		t.Fatal("violations should be an empty slice, not nil")
	}
}

// Position feeds the serial and the batch, so it has to be assigned and consumed
// under the same lock. If it is not, two concurrent pours print the same serial.
func TestConcurrentAppendsGetUniqueSerials(t *testing.T) {
	store := NewMemoryStore()
	const n = 64

	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.Append(func(pos int) (Record, error) {
				return Mint(req(1, honest()), pos, when)
			})
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()

	serials := map[string]bool{}
	positions := map[int]bool{}
	for _, r := range store.List() {
		if serials[r.Serial] {
			t.Fatalf("duplicate serial %q", r.Serial)
		}
		if positions[r.LedgerPosition] {
			t.Fatalf("duplicate ledger position %d", r.LedgerPosition)
		}
		serials[r.Serial] = true
		positions[r.LedgerPosition] = true
	}
	if len(serials) != n {
		t.Fatalf("expected %d records, got %d", n, len(serials))
	}
}

func TestListIsNewestFirst(t *testing.T) {
	store := NewMemoryStore()
	for i := 0; i < 3; i++ {
		if _, err := store.Append(func(pos int) (Record, error) { return Mint(req(0, honest()), pos, when) }); err != nil {
			t.Fatal(err)
		}
	}
	got := store.List()
	if got[0].LedgerPosition != 3 || got[2].LedgerPosition != 1 {
		t.Fatalf("expected newest first, got positions %d,%d,%d",
			got[0].LedgerPosition, got[1].LedgerPosition, got[2].LedgerPosition)
	}
}
