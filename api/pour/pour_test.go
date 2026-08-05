package pour

import (
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"moltenpour/api/sigil"
)

var when = time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)

// Two owners, because most of what is worth asserting about the ledger is what
// one of them cannot see.
const (
	ownerA = "owner-a"
	ownerB = "owner-b"
)

// Every Store implementation must behave identically. The memory one backs the
// tests; the SQLite one backs the server. A guarantee proved only against the
// map is a guarantee about the thing nobody runs.
func stores(t *testing.T) map[string]Store {
	t.Helper()
	sqlite, err := NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlite.Close() })
	return map[string]Store{"memory": NewMemoryStore(), "sqlite": sqlite}
}

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
	rec, err := Mint(req(3, sigil.Telemetry{DropletsLanded: 9e9, PeakVelocity: 9e9, TiltEnergy: 9e9, HoldMs: 9e9}), 1, ownerA, later)
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
	rec, err := Mint(req(5, sigil.Telemetry{DropletsLanded: 500, PeakVelocity: 2000, TiltEnergy: 90, HoldMs: 15000}), 1, ownerA, when.Add(2*time.Second))
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
			if _, err := Mint(r, 1, ownerA, when); err == nil {
				t.Fatal("expected rejection")
			}
		})
	}
}

func TestRejectsOutOfRangeTier(t *testing.T) {
	for _, tier := range []int{-1, 6, 99} {
		if _, err := Mint(req(tier, honest()), 1, ownerA, when); err == nil {
			t.Fatalf("tier %d should be rejected", tier)
		}
	}
}

// The certificate prints these verbatim, so their shape is part of the design.
func TestDerivedStringsMatchTheCertificateFormat(t *testing.T) {
	rec, err := Mint(req(3, honest()), 1284, ownerA, when)
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
	rec, err := Mint(req(2, honest()), 1, ownerA, when)
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
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			const n = 64

			var wg sync.WaitGroup
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					_, err := store.Append(func(pos int) (Record, error) {
						return Mint(req(1, honest()), pos, ownerA, when)
					})
					if err != nil {
						t.Error(err)
					}
				}()
			}
			wg.Wait()

			records, err := store.List(ownerA)
			if err != nil {
				t.Fatal(err)
			}

			serials := map[string]bool{}
			positions := map[int]bool{}
			for _, r := range records {
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
		})
	}
}

func TestListIsNewestFirst(t *testing.T) {
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			for i := 0; i < 3; i++ {
				if _, err := store.Append(func(pos int) (Record, error) {
					return Mint(req(0, honest()), pos, ownerA, when)
				}); err != nil {
					t.Fatal(err)
				}
			}
			got, err := store.List(ownerA)
			if err != nil {
				t.Fatal(err)
			}
			if got[0].LedgerPosition != 3 || got[2].LedgerPosition != 1 {
				t.Fatalf("expected newest first, got positions %d,%d,%d",
					got[0].LedgerPosition, got[1].LedgerPosition, got[2].LedgerPosition)
			}
		})
	}
}

// The gallery says YOUR POURS. Before ownership existed it showed everyone's,
// and any visitor could open any certificate by id. These are the assertions
// that make the heading true.
func TestOneOwnerCannotSeeAnother(t *testing.T) {
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			mine, err := store.Append(func(pos int) (Record, error) {
				return Mint(req(3, honest()), pos, ownerA, when)
			})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := store.Append(func(pos int) (Record, error) {
				return Mint(req(1, honest()), pos, ownerB, when)
			}); err != nil {
				t.Fatal(err)
			}

			listA, err := store.List(ownerA)
			if err != nil {
				t.Fatal(err)
			}
			if len(listA) != 1 || listA[0].ID != mine.ID {
				t.Fatalf("owner A should see exactly their own pour, got %d", len(listA))
			}

			// Not a permission error: whether a serial exists at all is not public
			// information, and a 403 would confirm it to anyone who guessed.
			if _, err := store.Get(mine.ID, ownerB); !errors.Is(err, ErrNotFound) {
				t.Fatalf("owner B reading owner A's pour: got %v, want ErrNotFound", err)
			}
			if _, err := store.Get(mine.ID, ownerA); err != nil {
				t.Fatalf("owner A cannot read their own pour: %v", err)
			}

			// An unknown owner has an empty collection, not everyone's.
			listC, err := store.List("owner-who-has-never-poured")
			if err != nil {
				t.Fatal(err)
			}
			if len(listC) != 0 {
				t.Fatalf("a new owner should see nothing, got %d", len(listC))
			}
		})
	}
}

// The ledger position is the Office's, not the visitor's: one continuous
// sequence across everyone, because the certificate's register depends on it.
func TestLedgerPositionIsGlobalNotPerOwner(t *testing.T) {
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			owners := []string{ownerA, ownerB, ownerA, ownerB}
			for i, owner := range owners {
				rec, err := store.Append(func(pos int) (Record, error) {
					return Mint(req(2, honest()), pos, owner, when)
				})
				if err != nil {
					t.Fatal(err)
				}
				if rec.LedgerPosition != i+1 {
					t.Fatalf("pour %d for %s got position %d, want %d — the ledger is not per-owner",
						i, owner, rec.LedgerPosition, i+1)
				}
			}
		})
	}
}

// The whole point of moving off the map: a serial and its ledger position must
// not be re-issued after a restart.
func TestLedgerSurvivesReopening(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.db")

	first, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	original, err := first.Append(func(pos int) (Record, error) {
		return Mint(req(4, honest()), pos, ownerA, when)
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()

	got, err := reopened.Get(original.ID, ownerA)
	if err != nil {
		t.Fatalf("the pour did not survive the restart: %v", err)
	}
	// Everything the certificate prints has to come back byte for byte.
	if got.Serial != original.Serial || got.Seed != original.Seed ||
		got.Rarity != original.Rarity || got.RarityScore != original.RarityScore ||
		got.Telemetry != original.Telemetry || got.MassGrams != original.MassGrams ||
		got.Batch != original.Batch || got.Issued != original.Issued {
		t.Fatalf("record changed across a restart:\n got %+v\nwant %+v", got, original)
	}

	next, err := reopened.Append(func(pos int) (Record, error) {
		return Mint(req(0, honest()), pos, ownerB, when)
	})
	if err != nil {
		t.Fatal(err)
	}
	if next.LedgerPosition != original.LedgerPosition+1 {
		t.Fatalf("ledger restarted at %d after reopening; No. %d was already issued",
			next.LedgerPosition, original.LedgerPosition)
	}
}

// Violations round-trip through the database as JSON, and the client iterates
// them. A null there is the nil-vs-empty distinction all over again.
func TestViolationsSurviveStorage(t *testing.T) {
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			overclaim := sigil.Telemetry{DropletsLanded: 9e9, PeakVelocity: 9e9, TiltEnergy: 9e9, HoldMs: 9e9}
			rec, err := store.Append(func(pos int) (Record, error) {
				return Mint(req(3, overclaim), pos, ownerA, when.Add(2*time.Second))
			})
			if err != nil {
				t.Fatal(err)
			}
			if len(rec.Violations) == 0 {
				t.Fatal("an overclaim on every field should have been flagged")
			}

			got, err := store.Get(rec.ID, ownerA)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got.Violations, rec.Violations) {
				t.Fatalf("violations changed in storage: got %v, want %v", got.Violations, rec.Violations)
			}

			clean, err := store.Append(func(pos int) (Record, error) {
				return Mint(req(1, honest()), pos, ownerA, when)
			})
			if err != nil {
				t.Fatal(err)
			}
			stored, err := store.Get(clean.ID, ownerA)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Violations == nil {
				t.Fatal("an honest pour should store [], not null")
			}
		})
	}
}
