package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Receipt validation is a stub, so a deployment that cannot charge must refuse
// the tiers it would otherwise give away. And it must refuse them BEFORE the
// ledger assigns a position: a refused pour that still advanced the sequence
// would put a gap in a register whose whole claim is that it is continuous.
func TestTierCeilingRefusesBeforeTheLedgerMoves(t *testing.T) {
	h := newTestServerWith(t, Config{MaxTierIndex: 0})
	v := newVisitor(t, h)

	body := func(tier int) string {
		return fmt.Sprintf(
			`{"tierIndex":%d,"timestampMs":%d,"telemetry":{"dropletsLanded":40,"peakVelocity":1200,"tiltEnergy":6,"holdMs":2000}}`,
			tier, now.Add(-3*time.Second).UnixMilli())
	}

	if w := v.do(http.MethodPost, "/api/pours", body(3)); w.Code != http.StatusBadRequest {
		t.Fatalf("paid tier: got %d, want 400 — body %s", w.Code, w.Body.String())
	}
	if got := v.list(); len(got) != 0 {
		t.Fatalf("a refused pour reached the ledger: %d records", len(got))
	}

	// The free tier still works, and takes position 1 rather than 2.
	rec := v.mint(0)
	if rec.LedgerPosition != 1 {
		t.Errorf("ledger position = %d, want 1 — the refused pour consumed one", rec.LedgerPosition)
	}
}

// The picker greys out what it cannot sell, which means it has to be told.
func TestConfigReportsTheTierCeiling(t *testing.T) {
	v := newVisitor(t, newTestServerWith(t, Config{MaxTierIndex: 2}))
	w := v.do(http.MethodGet, "/api/config", "")
	if w.Code != http.StatusOK {
		t.Fatalf("got %d", w.Code)
	}
	var got struct {
		MaxTierIndex int `json:"maxTierIndex"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.MaxTierIndex != 2 {
		t.Errorf("maxTierIndex = %d, want 2", got.MaxTierIndex)
	}
}

// The SPA and the API share an origin, so the file server sits under the same
// mux as the routes. It must never answer for a path the API owns: the client
// parses every /api response as JSON, and a page of HTML would surface as a
// syntax error rather than the 404 it is.
func TestStaticServingDoesNotShadowTheAPI(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) {
		t.Helper()
		p := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("index.html", "<!doctype html><title>MoltenPour</title>")
	write("proof.html", "<!doctype html><title>proof</title>")
	write("assets/index-abc123.js", "export default 1")

	h := newTestServerWith(t, Config{MaxTierIndex: 0, StaticDir: dir})
	v := newVisitor(t, h)

	for _, tc := range []struct {
		name      string
		path      string
		wantCode  int
		wantBody  string
		wantCache string
	}{
		{"root serves the app", "/", 200, "MoltenPour", "no-cache"},
		{
			// Vite builds proof.html as its own entry; it must stay itself
			// rather than disappearing into the fallback.
			"the proof sheet is a real document", "/proof.html", 200, "proof", "no-cache",
		},
		{
			// No client router — every view is state — so this only covers
			// refreshes and stray links.
			"an unknown path falls back to the app", "/collection", 200, "MoltenPour", "no-cache",
		},
		{
			// Content-hashed, so the name changes whenever the bytes do.
			"assets are immutable", "/assets/index-abc123.js", 200, "export default 1",
			"public, max-age=31536000, immutable",
		},
		{
			// A missing asset is a broken deploy, not a route. Answering with
			// index.html would hand JavaScript a page of HTML.
			// Not immutable: a year-long cache on a miss would pin the broken
			// deploy in the visitor's browser past the fix.
			"a missing asset is a 404", "/assets/gone.js", 404, "", "no-cache",
		},
		{"an unknown API path is JSON", "/api/nope", 404, `"error"`, ""},
		{"health still answers", "/api/health", 200, `"ok"`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := v.do(http.MethodGet, tc.path, "")
			if w.Code != tc.wantCode {
				t.Fatalf("got %d, want %d", w.Code, tc.wantCode)
			}
			if tc.wantBody != "" && !strings.Contains(w.Body.String(), tc.wantBody) {
				t.Errorf("body %q does not contain %q", w.Body.String(), tc.wantBody)
			}
			if tc.wantCache != "" {
				if got := w.Header().Get("Cache-Control"); got != tc.wantCache {
					t.Errorf("Cache-Control = %q, want %q", got, tc.wantCache)
				}
			}
		})
	}

	// And the routes themselves still work with the file server mounted.
	if rec := v.mint(0); rec.LedgerPosition != 1 {
		t.Errorf("minting through the mux with static mounted: position %d", rec.LedgerPosition)
	}
}

// Serving no static directory is the dev shape: Vite holds the app and proxies
// /api here, so an unknown path must not become a 200.
func TestWithoutStaticDirUnknownPathsAre404(t *testing.T) {
	v := newVisitor(t, newTestServerWith(t, Config{MaxTierIndex: 0}))
	if w := v.do(http.MethodGet, "/collection", ""); w.Code != http.StatusNotFound {
		t.Errorf("got %d, want 404", w.Code)
	}
}
