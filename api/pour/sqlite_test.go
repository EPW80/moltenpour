package pour

import (
	"path/filepath"
	"testing"
)

// scanRecord's positional scan order — mirrors selectColumns/Append's INSERT
// column list in sqlite.go. Index 10 is the violations column.
const violationsScanIndex = 10

// Malformed violations JSON should surface as an error, not a panic or a
// silently empty slice — this is the one place scanRecord does anything
// beyond copying scanned values, and it was previously only exercised
// indirectly (and only with well-formed JSON) via pour_test.go.
func TestScanRecordRejectsMalformedViolationsJSON(t *testing.T) {
	scan := func(dest ...any) error {
		for i, d := range dest {
			switch v := d.(type) {
			case *string:
				if i == violationsScanIndex {
					*v = "{not valid json"
				} else {
					*v = ""
				}
			case *int:
				*v = 0
			case *int64:
				*v = 0
			case *float64:
				*v = 0
			default:
				t.Fatalf("unexpected scan destination type %T at index %d", d, i)
			}
		}
		return nil
	}

	if _, err := scanRecord(scan); err == nil {
		t.Fatal("expected an error unmarshalling malformed violations JSON")
	}
}

// NewSQLiteStore wraps sql.Open and the schema Exec in fmt.Errorf(...: %w)
// (see the error-wrapping commit) — this pins that a store opened against an
// unwritable path actually fails rather than silently returning a broken
// store, the case an operator would hit first.
func TestNewSQLiteStoreRejectsAnUnusablePath(t *testing.T) {
	// The parent directory does not exist and SQLite will not create it.
	path := filepath.Join(t.TempDir(), "no-such-directory", "ledger.db")
	if _, err := NewSQLiteStore(path); err == nil {
		t.Fatal("expected an error opening a ledger under a nonexistent directory")
	}
}
