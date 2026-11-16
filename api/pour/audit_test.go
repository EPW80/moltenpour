package pour

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"moltenpour/api/sigil"
)

// seedAuditRow writes one pour directly through the store, dictating exactly the
// tier, rarity and violation set the audit is about to read. Timestamps march so
// each row is its own idempotency key rather than a replay.
func seedAuditRow(t *testing.T, store Store, counter *int, tier int, rarity sigil.Rarity, violations []string) {
	t.Helper()
	*counter++
	start := when.UnixMilli() - int64(*counter)
	key := MintKey{OwnerID: ownerA, TimestampMs: start, TierIndex: tier}
	if _, _, err := store.Append(ctx, key, func(pos int) (Record, error) {
		return Record{
			ID:             fmt.Sprintf("seed-%d", pos),
			OwnerID:        ownerA,
			LedgerPosition: pos,
			TierIndex:      tier,
			AmountCents:    amountCents[tier],
			TimestampMs:    start,
			Telemetry:      sigil.Telemetry{},
			Violations:     violations,
			Seed:           uint32(pos),
			Rarity:         rarity,
			RarityScore:    0,
			Serial:         fmt.Sprintf("MP-%07d-0000", pos),
			Batch:          "000-A",
			MassGrams:      0,
			Issued:         "2026-08-02",
		}, nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestAuditReportsRatesAndAlarms(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ledger.db")
	store, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}

	n := 0
	seedAuditRow(t, store, &n, 0, "Common", []string{})
	seedAuditRow(t, store, &n, 3, "Singular", []string{"holdMs"}) // overclaim on a reachable rung
	seedAuditRow(t, store, &n, 5, "Common", []string{})
	seedAuditRow(t, store, &n, 4, "Uncommon", []string{})
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	report, err := Audit(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if report.Total != 4 || report.HighestPosition != 4 {
		t.Fatalf("totals = %d/%d, want 4/4", report.Total, report.HighestPosition)
	}
	if report.Violations != 1 || report.ViolationRate() != 0.25 {
		t.Fatalf("violations = %d (rate %v), want 1/0.25", report.Violations, report.ViolationRate())
	}
	if report.Tiers345 != 3 || report.Singular345 != 1 {
		t.Fatalf("tiers 3-5 = %d (singular %d), want 3/1", report.Tiers345, report.Singular345)
	}

	alarms := report.Alarms()
	if len(alarms) != 2 {
		t.Fatalf("got %d alarms (%v), want 2", len(alarms), alarms)
	}
	if !strings.Contains(alarms[0], "overclaims") || !strings.Contains(alarms[1], "Singular") {
		t.Fatalf("unexpected alarms: %v", alarms)
	}
}

func TestAuditOfAnEmptyLedgerHasNoAlarms(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.db")
	store, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	report, err := Audit(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if report.Total != 0 || len(report.Alarms()) != 0 {
		t.Fatalf("empty ledger: total %d, alarms %v", report.Total, report.Alarms())
	}
}

// The corpus is the referee for the modeled rate, exactly as it is for the hash
// and the rarity: regenerate it and this test recomputes the baseline, so an
// alarm threshold cannot drift away from what the corpus actually models.
func TestModeledSingularShareMatchesCorpus(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "sigil", "testdata", "corpus.json"))
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Rows []struct {
			TierIndex int    `json:"tierIndex"`
			Rarity    string `json:"rarity"`
		} `json:"rows"`
	}
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	total, singular := 0, 0
	for _, r := range c.Rows {
		if r.TierIndex >= 3 && r.TierIndex <= 5 {
			total++
			if r.Rarity == "Singular" {
				singular++
			}
		}
	}
	if total == 0 {
		t.Fatal("corpus has no tiers 3-5 rows")
	}
	if got := float64(singular) / float64(total); math.Abs(got-ModeledSingularShare345) > 1e-12 {
		t.Fatalf("ModeledSingularShare345 = %v but corpus models %v/%v = %v; update the constant", ModeledSingularShare345, singular, total, got)
	}
}