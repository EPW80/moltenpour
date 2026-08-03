package sigil

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
)

type row struct {
	TierIndex   int       `json:"tierIndex"`
	WallClockMs float64   `json:"wallClockMs"`
	Raw         Telemetry `json:"raw"`
	TimestampMs int64     `json:"timestampMs"`
	AmountCents int       `json:"amountCents"`
	Clamped     Telemetry `json:"clamped"`
	Violations  []string  `json:"violations"`
	Hash        uint32    `json:"hash"`
}

func load(t *testing.T) []row {
	t.Helper()
	b, err := os.ReadFile("testdata/corpus.json")
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Version int   `json:"version"`
		Rows    []row `json:"rows"`
	}
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	return c.Rows
}

func sorted(s []string) []string {
	// Always non-nil: append([]string(nil)) with zero elements returns nil,
	// which makes reflect.DeepEqual distinguish [] from nil. Both mean
	// "no violations" here.
	out := make([]string, len(s))
	copy(out, s)
	for i := range out {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func TestClampMatchesTypeScript(t *testing.T) {
	for i, r := range load(t) {
		got := ClampTelemetry(r.Raw, r.TierIndex, r.WallClockMs)
		if got.Telemetry != r.Clamped {
			t.Fatalf("row %d clamp mismatch\n go: %+v\n ts: %+v", i, got.Telemetry, r.Clamped)
		}
		if !reflect.DeepEqual(sorted(got.Violations), sorted(r.Violations)) {
			t.Fatalf("row %d violations mismatch\n go: %v\n ts: %v", i, sorted(got.Violations), sorted(r.Violations))
		}
	}
}

func TestHashMatchesTypeScript(t *testing.T) {
	for i, r := range load(t) {
		got := HashSeed(BurnSeed{
			TierIndex: r.TierIndex, AmountCents: r.AmountCents,
			TimestampMs: r.TimestampMs, Telemetry: r.Clamped,
		})
		if got != r.Hash {
			t.Fatalf("row %d hash mismatch: go=%d ts=%d (ts=%d)", i, got, r.Hash, r.TimestampMs)
		}
	}
}

// Go's float->int conversion is implementation-specific for NaN/Inf; JS
// ToUint32 yields 0. Hashing must never be platform-dependent.
func TestToUint32HandlesNonFinite(t *testing.T) {
	for _, v := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if got := toUint32(v); got != 0 {
			t.Fatalf("toUint32(%v) = %d, want 0", v, got)
		}
	}
}

// A caller that skips ClampTelemetry must still get a stable hash.
func TestHashStableWithNonFiniteTelemetry(t *testing.T) {
	s := BurnSeed{TierIndex: 2, AmountCents: 999, TimestampMs: 1750000000000,
		Telemetry: Telemetry{math.NaN(), math.Inf(1), math.NaN(), 5000}}
	if HashSeed(s) != HashSeed(s) {
		t.Fatal("hash unstable for non-finite telemetry")
	}
}
