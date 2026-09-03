package session

import (
	"crypto/tls"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func quiet() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func manager() *Manager { return New("test-secret", false, quiet()) }

// The id in the cookie is the only thing separating one collection from another,
// so it has to be minted, signed, and returned.
func TestMintsAndSetsACookie(t *testing.T) {
	m := manager()
	w := httptest.NewRecorder()

	id, err := m.OwnerID(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	if id == "" {
		t.Fatal("no owner id")
	}

	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one cookie, got %d", len(cookies))
	}
	c := cookies[0]
	if !c.HttpOnly {
		t.Error("cookie must be HttpOnly — script that can read it can lift a whole collection")
	}
	if c.SameSite != http.SameSiteLaxMode {
		t.Error("cookie must be SameSite=Lax")
	}
	if !strings.HasPrefix(c.Value, id+".") {
		t.Fatalf("cookie %q does not carry the signed id", c.Value)
	}
}

func TestReturningVisitorKeepsTheirID(t *testing.T) {
	m := manager()
	w := httptest.NewRecorder()
	first, err := m.OwnerID(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatal(err)
	}

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.AddCookie(w.Result().Cookies()[0])
	w2 := httptest.NewRecorder()
	second, err := m.OwnerID(w2, r)
	if err != nil {
		t.Fatal(err)
	}

	if second != first {
		t.Fatalf("owner changed across requests: %q then %q", first, second)
	}
	if len(w2.Result().Cookies()) != 0 {
		t.Error("a valid cookie should not be re-issued")
	}
}

// The point of signing. Editing the id to read someone else's ledger must fail,
// and must fail closed — the visitor becomes a new owner with nothing, rather
// than being handed the id they asked for.
func TestForgedCookieIsRejected(t *testing.T) {
	m := manager()
	w := httptest.NewRecorder()
	real, err := m.OwnerID(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	valid := w.Result().Cookies()[0].Value

	for _, tc := range []struct {
		name  string
		value string
	}{
		{"someone else's id, no signature", "victim-owner-id"},
		{"someone else's id with a stolen signature", "victim-owner-id." + strings.SplitN(valid, ".", 2)[1]},
		{"empty", ""},
		{"signature only", "." + strings.SplitN(valid, ".", 2)[1]},
		{"garbage", "not.a.real.cookie"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.AddCookie(&http.Cookie{Name: cookieName, Value: tc.value})
			rec := httptest.NewRecorder()

			got, err := m.OwnerID(rec, r)
			if err != nil {
				t.Fatal(err)
			}
			if got == "victim-owner-id" {
				t.Fatal("a forged cookie was accepted")
			}
			if got == real {
				t.Fatal("a forged cookie resolved to an existing owner")
			}
			if len(rec.Result().Cookies()) != 1 {
				t.Error("a rejected cookie should be replaced with a fresh one")
			}
		})
	}
}

// A cookie signed with one secret must not verify under another, or rotating
// the secret would not actually invalidate anything.
func TestCookieDoesNotVerifyUnderADifferentSecret(t *testing.T) {
	w := httptest.NewRecorder()
	if _, err := New("secret-one", false, quiet()).OwnerID(w, httptest.NewRequest(http.MethodGet, "/", nil)); err != nil {
		t.Fatal(err)
	}

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.AddCookie(w.Result().Cookies()[0])
	rec := httptest.NewRecorder()
	if _, err := New("secret-two", false, quiet()).OwnerID(rec, r); err != nil {
		t.Fatal(err)
	}
	if len(rec.Result().Cookies()) != 1 {
		t.Fatal("a cookie from another secret should have been rejected and replaced")
	}
}

// Behind Fly, Render or any other TLS-terminating proxy the request reaches this
// process over plain HTTP, so r.TLS is nil on exactly the deployments where the
// cookie most needs Secure. The forwarded header is the only evidence there is —
// and it is evidence only where a proxy is known to be overwriting it.
func TestSecureFlagFollowsTheVisitorsScheme(t *testing.T) {
	for _, tc := range []struct {
		name       string
		trustProxy bool
		forwarded  string
		tls        bool
		wantSecure bool
	}{
		{name: "plain localhost", wantSecure: false},
		{name: "direct TLS", tls: true, wantSecure: true},
		{
			name: "untrusted forwarded header is not evidence",
			// A visitor can send this header themselves. Honouring it without a
			// proxy in front would let them choose their own cookie's flags.
			forwarded: "https", trustProxy: false, wantSecure: false,
		},
		{name: "trusted proxy, https", trustProxy: true, forwarded: "https", wantSecure: true},
		{name: "trusted proxy, proxy chain", trustProxy: true, forwarded: "https, http", wantSecure: true},
		{name: "trusted proxy, plain http", trustProxy: true, forwarded: "http", wantSecure: false},
		{name: "trusted proxy, no header", trustProxy: true, wantSecure: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			if tc.forwarded != "" {
				r.Header.Set("X-Forwarded-Proto", tc.forwarded)
			}
			if tc.tls {
				r.TLS = &tls.ConnectionState{}
			}

			w := httptest.NewRecorder()
			if _, err := New("test-secret", tc.trustProxy, quiet()).OwnerID(w, r); err != nil {
				t.Fatal(err)
			}
			cookies := w.Result().Cookies()
			if len(cookies) != 1 {
				t.Fatalf("expected one cookie, got %d", len(cookies))
			}
			if got := cookies[0].Secure; got != tc.wantSecure {
				t.Errorf("Secure = %v, want %v", got, tc.wantSecure)
			}
		})
	}
}
