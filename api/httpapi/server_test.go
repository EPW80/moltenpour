package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"moltenpour/api/pour"
	"moltenpour/api/session"
)

// A fixed clock, so the mint's timestamp window is deterministic.
var now = time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)

func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	store, err := pour.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	s := New(store, session.New("test-secret", log), log)
	s.now = func() time.Time { return now }
	return s.Routes()
}

// A visitor: one handler plus one cookie jar, which is all "a browser" means here.
type visitor struct {
	t       *testing.T
	handler http.Handler
	cookies []*http.Cookie
}

func newVisitor(t *testing.T, h http.Handler) *visitor {
	return &visitor{t: t, handler: h}
}

func (v *visitor) do(method, path, body string) *httptest.ResponseRecorder {
	v.t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("content-type", "application/json")
	}
	for _, c := range v.cookies {
		r.AddCookie(c)
	}

	w := httptest.NewRecorder()
	v.handler.ServeHTTP(w, r)

	// Keep whatever the server set, exactly as a browser would.
	if set := w.Result().Cookies(); len(set) > 0 {
		v.cookies = set
	}
	return w
}

func (v *visitor) mint(tier int) pour.Record {
	v.t.Helper()
	body := fmt.Sprintf(
		`{"tierIndex":%d,"timestampMs":%d,"telemetry":{"dropletsLanded":40,"peakVelocity":1200,"tiltEnergy":6,"holdMs":2000}}`,
		tier, now.Add(-3*time.Second).UnixMilli())

	w := v.do(http.MethodPost, "/api/pours", body)
	if w.Code != http.StatusCreated {
		v.t.Fatalf("mint: got %d, body %s", w.Code, w.Body.String())
	}
	var rec pour.Record
	if err := json.Unmarshal(w.Body.Bytes(), &rec); err != nil {
		v.t.Fatal(err)
	}
	return rec
}

func (v *visitor) list() []pour.Record {
	v.t.Helper()
	w := v.do(http.MethodGet, "/api/pours", "")
	if w.Code != http.StatusOK {
		v.t.Fatalf("list: got %d", w.Code)
	}
	var out []pour.Record
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		v.t.Fatal(err)
	}
	return out
}

// The end-to-end version of the guarantee: two browsers, one server, and
// neither can see the other's ledger. This is what "YOUR POURS" now means.
func TestTwoVisitorsHaveSeparateLedgers(t *testing.T) {
	h := newTestServer(t)
	alice := newVisitor(t, h)
	bob := newVisitor(t, h)

	first := alice.mint(3)
	second := alice.mint(1)
	bobs := bob.mint(0)

	if got := alice.list(); len(got) != 2 {
		t.Fatalf("alice should see her 2 pours, saw %d", len(got))
	}
	if got := bob.list(); len(got) != 1 || got[0].ID != bobs.ID {
		t.Fatalf("bob should see only his own pour, saw %d", len(got))
	}

	// Bob knows the id — it is in Alice's URL — and still must not get the record.
	w := bob.do(http.MethodGet, "/api/pours/"+first.ID, "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("bob reading alice's certificate: got %d, want 404", w.Code)
	}

	if w := alice.do(http.MethodGet, "/api/pours/"+second.ID, ""); w.Code != http.StatusOK {
		t.Fatalf("alice reading her own certificate: got %d", w.Code)
	}
}

// The ledger position is the Office's. Two visitors interleaving still produce
// one continuous sequence.
func TestLedgerPositionIsSharedAcrossVisitors(t *testing.T) {
	h := newTestServer(t)
	alice := newVisitor(t, h)
	bob := newVisitor(t, h)

	for i, rec := range []pour.Record{alice.mint(2), bob.mint(2), alice.mint(2)} {
		if rec.LedgerPosition != i+1 {
			t.Fatalf("pour %d got position %d, want %d", i, rec.LedgerPosition, i+1)
		}
	}
}

// Owner ids are server-side only. Leaking one into a response body would hand
// out the credential that the whole scheme rests on.
func TestOwnerIDIsNeverSerialised(t *testing.T) {
	h := newTestServer(t)
	v := newVisitor(t, h)
	rec := v.mint(4)

	for _, path := range []string{"/api/pours", "/api/pours/" + rec.ID} {
		body := v.do(http.MethodGet, path, "").Body.String()
		if strings.Contains(body, "ownerId") || strings.Contains(body, "owner_id") || strings.Contains(body, "OwnerID") {
			t.Fatalf("%s leaked an owner id: %s", path, body)
		}
	}
}

func TestFreshVisitorSeesAnEmptyLedger(t *testing.T) {
	h := newTestServer(t)
	newVisitor(t, h).mint(1)

	stranger := newVisitor(t, h)
	if got := stranger.list(); len(got) != 0 {
		t.Fatalf("a visitor who has never poured saw %d pours", len(got))
	}
	// [] rather than null: the gallery maps over this.
	if body := strings.TrimSpace(stranger.do(http.MethodGet, "/api/pours", "").Body.String()); body != "[]" {
		t.Fatalf("empty ledger serialised as %q, want []", body)
	}
}

func TestMintRejectsBadRequests(t *testing.T) {
	h := newTestServer(t)
	v := newVisitor(t, h)

	for _, tc := range []struct{ name, body string }{
		{"malformed json", `{`},
		{"unknown field", `{"tierIndex":1,"timestampMs":1,"telemetry":{},"ownerId":"someone-else"}`},
		{"tier out of range", fmt.Sprintf(`{"tierIndex":99,"timestampMs":%d,"telemetry":{"dropletsLanded":1,"peakVelocity":1,"tiltEnergy":1,"holdMs":1}}`, now.UnixMilli())},
		{"stale timestamp", `{"tierIndex":1,"timestampMs":1,"telemetry":{"dropletsLanded":1,"peakVelocity":1,"tiltEnergy":1,"holdMs":1}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if w := v.do(http.MethodPost, "/api/pours", tc.body); w.Code != http.StatusBadRequest {
				t.Fatalf("got %d, want 400 (body %s)", w.Code, w.Body.String())
			}
		})
	}
}

// A client cannot name its own owner: the field is rejected outright by
// DisallowUnknownFields, and ownership comes from the signed cookie regardless.
func TestClientCannotChooseItsOwner(t *testing.T) {
	h := newTestServer(t)
	alice := newVisitor(t, h)
	mine := alice.mint(2)

	bob := newVisitor(t, h)
	body := fmt.Sprintf(
		`{"tierIndex":2,"timestampMs":%d,"telemetry":{"dropletsLanded":40,"peakVelocity":1200,"tiltEnergy":6,"holdMs":2000},"ownerId":%q}`,
		now.Add(-3*time.Second).UnixMilli(), "alice")
	if w := bob.do(http.MethodPost, "/api/pours", body); w.Code != http.StatusBadRequest {
		t.Fatalf("naming an owner in the body should be rejected, got %d", w.Code)
	}

	if got := alice.list(); len(got) != 1 || got[0].ID != mine.ID {
		t.Fatalf("alice's ledger was disturbed: %d pours", len(got))
	}
}

func TestHealthNeedsNoSession(t *testing.T) {
	h := newTestServer(t)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("health: got %d", w.Code)
	}
}
