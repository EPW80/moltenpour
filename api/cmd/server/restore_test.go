package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"moltenpour/api/pour"
)

func TestRestoreRehearsal(t *testing.T) {
	repo, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	for _, occupied := range []bool{true, false} {
		name := "isolated restore"
		if occupied {
			name = "occupied port"
		}
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			snapshot := filepath.Join(dir, "snapshot.db")
			store, err := pour.NewSQLiteStore(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(snapshot)
			if err != nil {
				t.Fatal(err)
			}

			port := "0" // Let the rehearsal bind an unused port itself.
			var posts atomic.Int32
			if occupied {
				other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method == http.MethodPost {
						posts.Add(1)
						w.WriteHeader(http.StatusCreated)
						_, _ = w.Write([]byte(`{"ledgerPosition":1}`))
					}
				}))
				defer other.Close()
				port = other.URL[strings.LastIndex(other.URL, ":")+1:]
			}

			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			input := snapshot
			if !occupied {
				input = "snapshot.db" // Resolve relative to caller, outside the repo.
			}
			cmd := exec.CommandContext(ctx, filepath.Join(repo, "scripts/restore-rehearsal.sh"), input, port)
			cmd.Dir = dir
			cmd.Env = append(os.Environ(), "MOLTENPOUR_ENV=development", "MOLTENPOUR_MAX_TIER=0", "TMPDIR="+dir)
			out, err := cmd.CombinedOutput()
			if posts.Load() != 0 {
				t.Fatalf("rehearsal sent %d mints to another server:\n%s", posts.Load(), out)
			}
			if occupied && err == nil {
				t.Fatalf("rehearsal accepted an occupied port:\n%s", out)
			}
			if occupied && !strings.Contains(string(out), "binding server") {
				t.Fatalf("rehearsal did not report the bind failure: %v\n%s", err, out)
			}
			if !occupied && (err != nil || !strings.Contains(string(out), "minted position 1 on top of snapshot max 0")) {
				t.Fatalf("restore failed: %v\n%s", err, out)
			}
			after, err := os.ReadFile(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if string(before) != string(after) {
				t.Fatal("rehearsal changed its source snapshot")
			}
		})
	}
}
