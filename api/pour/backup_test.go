package pour

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"moltenpour/api/sigil"
)

func TestSnapshotRestoresCommittedWALAndContinuesLedger(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.db")
	destination := filepath.Join(dir, "snapshot.db")
	store, err := NewSQLiteStore(source)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for i := 0; i < 3; i++ {
		if _, _, err := appendPour(store, ownerA, fresh(0, sigil.Telemetry{HoldMs: 1}), when); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Stat(source + "-wal"); err != nil {
		t.Fatalf("expected live WAL: %v", err)
	}
	if err := SnapshotSQLite(ctx, source, destination); err != nil {
		t.Fatal(err)
	}
	restored, err := NewSQLiteStore(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	want, err := store.List(ctx, ownerA)
	if err != nil {
		t.Fatal(err)
	}
	got, err := restored.List(ctx, ownerA)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("snapshot records differ: got %v, want %v", got, want)
	}
	next, _, err := appendPour(restored, ownerA, fresh(0, sigil.Telemetry{}), when)
	if err != nil {
		t.Fatal(err)
	}
	if next.LedgerPosition != 4 {
		t.Fatalf("next position = %d, want 4", next.LedgerPosition)
	}
	if err := SnapshotSQLite(ctx, source, destination); err == nil {
		t.Fatal("overwrote an existing backup")
	}
}

func TestBackupRefusesMissingAndCorruptSources(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "missing.db")
	if err := SnapshotSQLite(ctx, missing, filepath.Join(dir, "out.db")); err == nil {
		t.Fatal("accepted missing ledger")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatal("created the missing source")
	}
	corrupt := filepath.Join(dir, "corrupt.db")
	if err := os.WriteFile(corrupt, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := VerifySQLite(ctx, corrupt); err == nil {
		t.Fatal("accepted corrupt snapshot")
	}
}

func TestSnapshotWhileWriterAppends(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.db")
	store, err := NewSQLiteStore(source)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, _, err := appendPour(store, ownerA, fresh(0, sigil.Telemetry{}), when); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		close(started)
		for i := 0; i < 50; i++ {
			if _, _, err := appendPour(store, ownerA, fresh(0, sigil.Telemetry{}), when); err != nil {
				finished <- err
				return
			}
		}
		finished <- nil
	}()
	<-started
	destination := filepath.Join(dir, "snapshot.db")
	backupErr := SnapshotSQLite(ctx, source, destination)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if backupErr != nil {
		t.Fatal(backupErr)
	}
	restored, err := NewSQLiteStore(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	records, err := restored.List(ctx, ownerA)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) < 1 || len(records) > 51 {
		t.Fatalf("snapshot contains %d records", len(records))
	}
	for i, record := range records {
		if record.LedgerPosition != len(records)-i {
			t.Fatal("snapshot is not a committed contiguous ledger")
		}
	}
}
