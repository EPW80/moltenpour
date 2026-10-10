package pour

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"moltenpour/api/sigil"
)

var ctx = context.Background()

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

// starts hands out distinct pour-start times. (owner, timestampMs) is the
// idempotency key, so tests that mean to mint several pours must start each one
// at its own millisecond — reusing req's fixed one would replay the first.
var starts atomic.Int64

// fresh is req at a pour-start no other call has used.
func fresh(tier int, t sigil.Telemetry) Request {
	r := req(tier, t)
	r.TimestampMs -= starts.Add(1)
	return r
}

// appendPour is the mint call the HTTP handler makes: the key comes from the
// same owner and request the mint does.
func appendPour(store Store, owner string, r Request, now time.Time) (Record, bool, error) {
	key := MintKey{OwnerID: owner, TimestampMs: r.TimestampMs, TierIndex: r.TierIndex}
	return store.Append(ctx, key, func(pos int) (Record, error) {
		return Mint(r, pos, owner, now)
	})
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
					_, _, err := appendPour(store, ownerA, fresh(1, honest()), when)
					if err != nil {
						t.Error(err)
					}
				}()
			}
			wg.Wait()

			records, err := store.List(ctx, ownerA)
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

			// And the other half: n concurrent retries of ONE pour — a client
			// hammering resend after a lost response — must land on one row. If
			// the replay lookup sat outside the lock, several would miss and mint.
			same := fresh(2, honest())
			var minted atomic.Int64
			ids := make([]string, n)
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					rec, replayed, err := appendPour(store, ownerA, same, when)
					if err != nil {
						t.Error(err)
						return
					}
					if !replayed {
						minted.Add(1)
					}
					ids[i] = rec.ID
				}()
			}
			wg.Wait()

			if got := minted.Load(); got != 1 {
				t.Fatalf("%d concurrent retries of one pour minted %d times, want 1", n, got)
			}
			for _, id := range ids {
				if id != ids[0] {
					t.Fatalf("retries of one pour came back as different pours: %q and %q", ids[0], id)
				}
			}
			records, err = store.List(ctx, ownerA)
			if err != nil {
				t.Fatal(err)
			}
			if len(records) != n+1 {
				t.Fatalf("expected %d records after the retries, got %d", n+1, len(records))
			}
		})
	}
}

func TestListIsNewestFirst(t *testing.T) {
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			for i := 0; i < 3; i++ {
				if _, _, err := appendPour(store, ownerA, fresh(0, honest()), when); err != nil {
					t.Fatal(err)
				}
			}
			got, err := store.List(ctx, ownerA)
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
			mine, _, err := appendPour(store, ownerA, fresh(3, honest()), when)
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err := appendPour(store, ownerB, fresh(1, honest()), when); err != nil {
				t.Fatal(err)
			}

			listA, err := store.List(ctx, ownerA)
			if err != nil {
				t.Fatal(err)
			}
			if len(listA) != 1 || listA[0].ID != mine.ID {
				t.Fatalf("owner A should see exactly their own pour, got %d", len(listA))
			}

			// Not a permission error: whether a serial exists at all is not public
			// information, and a 403 would confirm it to anyone who guessed.
			if _, err := store.Get(ctx, mine.ID, ownerB); !errors.Is(err, ErrNotFound) {
				t.Fatalf("owner B reading owner A's pour: got %v, want ErrNotFound", err)
			}
			if _, err := store.Get(ctx, mine.ID, ownerA); err != nil {
				t.Fatalf("owner A cannot read their own pour: %v", err)
			}

			// An unknown owner has an empty collection, not everyone's.
			listC, err := store.List(ctx, "owner-who-has-never-poured")
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
				rec, _, err := appendPour(store, owner, fresh(2, honest()), when)
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
	original, _, err := appendPour(first, ownerA, fresh(4, honest()), when)
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

	got, err := reopened.Get(ctx, original.ID, ownerA)
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

	next, _, err := appendPour(reopened, ownerB, fresh(0, honest()), when)
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
			rec, _, err := appendPour(store, ownerA, fresh(3, overclaim), when.Add(2*time.Second))
			if err != nil {
				t.Fatal(err)
			}
			if len(rec.Violations) == 0 {
				t.Fatal("an overclaim on every field should have been flagged")
			}

			got, err := store.Get(ctx, rec.ID, ownerA)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got.Violations, rec.Violations) {
				t.Fatalf("violations changed in storage: got %v, want %v", got.Violations, rec.Violations)
			}

			clean, _, err := appendPour(store, ownerA, fresh(1, honest()), when)
			if err != nil {
				t.Fatal(err)
			}
			stored, err := store.Get(ctx, clean.ID, ownerA)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Violations == nil {
				t.Fatal("an honest pour should store [], not null")
			}
		})
	}
}

// The lost-response retry: the client resends the same pour-start, and must get
// back the pour it already has rather than a second ledger position. The retry's
// telemetry is ignored — the first write is canonical — and mint is not called.
func TestReplayReturnsTheOriginal(t *testing.T) {
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			first := fresh(3, honest())
			original, replayed, err := appendPour(store, ownerA, first, when)
			if err != nil {
				t.Fatal(err)
			}
			if replayed {
				t.Fatal("a first mint reported itself as a replay")
			}

			retry := first
			retry.Telemetry = sigil.Telemetry{DropletsLanded: 1, PeakVelocity: 1, TiltEnergy: 1, HoldMs: 1}
			key := MintKey{OwnerID: ownerA, TimestampMs: retry.TimestampMs, TierIndex: retry.TierIndex}
			got, replayed, err := store.Append(ctx, key, func(int) (Record, error) {
				t.Fatal("mint ran for a pour already on the ledger")
				return Record{}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if !replayed {
				t.Fatal("a retry was not reported as a replay")
			}
			if !reflect.DeepEqual(got, original) {
				t.Fatalf("replay returned a different record:\n got %+v\nwant %+v", got, original)
			}

			if list, err := store.List(ctx, ownerA); err != nil || len(list) != 1 {
				t.Fatalf("a retry should leave one pour on the ledger, got %d (err %v)", len(list), err)
			}
		})
	}
}

// Same owner and pour-start under a different tier is not a retry — it is a
// different pour claiming the same start, and answering it with the stored one
// would hand back a certificate for a tier that was not asked for.
func TestReplayWithADifferentTierConflicts(t *testing.T) {
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			r := fresh(2, honest())
			if _, _, err := appendPour(store, ownerA, r, when); err != nil {
				t.Fatal(err)
			}
			r.TierIndex = 4
			if _, _, err := appendPour(store, ownerA, r, when); !errors.Is(err, ErrConflict) {
				t.Fatalf("got %v, want ErrConflict", err)
			}
			if list, _ := store.List(ctx, ownerA); len(list) != 1 {
				t.Fatalf("a conflicting mint was recorded: %d pours", len(list))
			}
		})
	}
}

// A retry can arrive long after the pour — the server was down, the client kept
// the pour for another attempt. The lookup precedes Mint, so the skew window
// that would reject a fresh request at this time does not reject a replay.
func TestReplayAfterTheSkewWindowStillSucceeds(t *testing.T) {
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			r := fresh(1, honest())
			original, _, err := appendPour(store, ownerA, r, when)
			if err != nil {
				t.Fatal(err)
			}

			late := when.Add(2 * maxClockSkew)
			if _, err := Mint(r, 2, ownerA, late); !errors.Is(err, ErrValidation) {
				t.Fatal("the retry time is inside the window; test proves nothing")
			}

			got, replayed, err := appendPour(store, ownerA, r, late)
			if err != nil {
				t.Fatalf("a late replay was refused: %v", err)
			}
			if !replayed || got.ID != original.ID {
				t.Fatalf("late replay: replayed=%v id=%q, want the original %q", replayed, got.ID, original.ID)
			}
		})
	}
}

// The key includes the owner. Two visitors starting in the same millisecond are
// two pours, and one must never be answered with the other's.
func TestSameStartForDifferentOwnersIsTwoPours(t *testing.T) {
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			r := fresh(2, honest())
			a, _, err := appendPour(store, ownerA, r, when)
			if err != nil {
				t.Fatal(err)
			}
			b, replayed, err := appendPour(store, ownerB, r, when)
			if err != nil {
				t.Fatal(err)
			}
			if replayed || a.LedgerPosition == b.LedgerPosition {
				t.Fatalf("owner B's pour was treated as a replay of owner A's")
			}
		})
	}
}

// writeLegacyLedger creates a ledger as it was before the start index existed:
// the same table, no pours_owner_start.
func writeLegacyLedger(t *testing.T, path string, rows ...[2]any) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	for i, row := range rows {
		if _, err := db.Exec(`
			INSERT INTO pours (
				id, owner_id, ledger_position, tier_index, amount_cents, timestamp_ms,
				droplets_landed, peak_velocity, tilt_energy, hold_ms,
				violations, seed, rarity, rarity_score, serial, batch, mass_grams, issued
			) VALUES (?, ?, ?, 0, 0, ?, 0, 0, 0, 0, '[]', 0, 'Common', 0, ?, '001-A', 0, '2026-08-02')`,
			fmt.Sprintf("legacy-%d", i), row[0], i+1, row[1], fmt.Sprintf("MP-%07d-0000", i+1),
		); err != nil {
			t.Fatal(err)
		}
	}
}

// A ledger that predates idempotency picks up the index on its next open —
// CREATE ... IF NOT EXISTS, no migration step for an operator to forget.
func TestExistingLedgerGetsTheStartIndexOnOpen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.db")
	writeLegacyLedger(t, path, [2]any{ownerA, when.UnixMilli()}, [2]any{ownerA, when.UnixMilli() + 1})

	store, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	var unique int
	if err := store.(*sqliteStore).db.QueryRow(
		`SELECT "unique" FROM pragma_index_list('pours') WHERE name = 'pours_owner_start'`,
	).Scan(&unique); err != nil {
		t.Fatalf("pours_owner_start missing after reopening a legacy ledger: %v", err)
	}
	if unique != 1 {
		t.Fatal("pours_owner_start exists but is not UNIQUE")
	}
}

// The ledger this index is fixing can already hold the duplicates it forbids.
// Opening one must fail, and say why, rather than hand over a bare constraint
// error or — worse — start without the guarantee.
func TestDuplicateStartsInAnExistingLedgerAreNamed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.db")
	writeLegacyLedger(t, path, [2]any{ownerA, when.UnixMilli()}, [2]any{ownerA, when.UnixMilli()})

	_, err := NewSQLiteStore(path)
	if err == nil {
		t.Fatal("opened a ledger holding duplicate pour-starts")
	}
	if !strings.Contains(err.Error(), "minted more than once") {
		t.Fatalf("error does not name the duplicates: %v", err)
	}
}
