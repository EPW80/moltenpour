package pour

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The price is part of the sigil's seed (BurnSeed.AmountCents), and the corpus
// is generated from the TypeScript tier table in app/ceremony/tiers.ts, with
// each row recording the price TypeScript used at that tier. Comparing against
// it rather than against a third copy of the numbers closes the one drift the
// corpus does not check on its own: api/sigil's tests re-hash with the corpus's
// amount, so a Go-only reprice would leave them green while the client previewed
// one sigil and the ledger minted another.
//
// A failure here means one of the two tables was edited without the other. Edit
// TypeScript, regenerate the corpus under Node 22, then fix this table.
func TestPricesMatchTheCorpus(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "sigil", "testdata", "corpus.json"))
	if err != nil {
		t.Fatalf("reading the corpus: %v", err)
	}
	var corpus struct {
		Rows []struct {
			TierIndex   int `json:"tierIndex"`
			AmountCents int `json:"amountCents"`
		} `json:"rows"`
	}
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatalf("parsing the corpus: %v", err)
	}
	if len(corpus.Rows) == 0 {
		t.Fatal("no corpus rows — the price table would be unpinned")
	}

	seen := map[int]bool{}
	for _, row := range corpus.Rows {
		if row.TierIndex < 0 || row.TierIndex >= len(amountCents) {
			t.Errorf("corpus row at tier %d is outside the Go price table", row.TierIndex)
			continue
		}
		if got, want := amountCents[row.TierIndex], row.AmountCents; got != want {
			t.Errorf("tier %d: go=%d ts=%d — a preview would not match the mint", row.TierIndex, got, want)
		}
		seen[row.TierIndex] = true
	}
	if len(seen) != len(amountCents) {
		t.Errorf("the corpus covers %d of %d tiers; the rest are unpinned", len(seen), len(amountCents))
	}
}
