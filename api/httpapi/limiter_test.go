package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestLimiterRefillsOverTime(t *testing.T) {
	l := newLimiter(2, 10*time.Second)
	t0 := time.Unix(1_700_000_000, 0)
	for i := 0; i < 2; i++ {
		if ok, _ := l.allow("a", t0); !ok {
			t.Fatalf("request %d inside the burst was refused", i+1)
		}
	}
	ok, wait := l.allow("a", t0)
	if ok || wait <= 0 || wait > 10*time.Second {
		t.Fatalf("third request: ok=%v wait=%v, want refused with a wait up to 10s", ok, wait)
	}
	if ok, _ := l.allow("b", t0); !ok {
		t.Error("another key shares nothing with the first")
	}
	if ok, _ := l.allow("a", t0.Add(10*time.Second)); !ok {
		t.Error("a token should have come back after one interval")
	}
	if ok, _ := l.allow("a", t0.Add(10*time.Second)); ok {
		t.Error("only one token should have come back")
	}
}

func TestLimiterSweepsIdleKeys(t *testing.T) {
	l := newLimiter(2, time.Second)
	t0 := time.Unix(1_700_000_000, 0)
	for i := 0; i < 100; i++ {
		l.allow(strconv.Itoa(i), t0)
	}
	l.allow("late", t0.Add(time.Hour))
	if n := len(l.buckets); n != 1 {
		t.Errorf("%d buckets after an idle hour, want only the live one", n)
	}
}

func mintFrom(h http.Handler, remote string, startMs int64) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/pours", strings.NewReader(mintBody(0, startMs)))
	r.Header.Set("content-type", "application/json")
	r.RemoteAddr = remote
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestMintIsRateLimitedPerClient(t *testing.T) {
	h := newTestServerWith(t, Config{MintBurst: 2, MintEvery: time.Minute})

	for i := 0; i < 2; i++ {
		if w := mintFrom(h, "203.0.113.1:1", freshStart()); w.Code != http.StatusCreated {
			t.Fatalf("mint %d inside the burst: %d %s", i+1, w.Code, w.Body)
		}
	}
	w := mintFrom(h, "203.0.113.1:1", freshStart())
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("third mint: %d, want 429", w.Code)
	}
	if secs, err := strconv.Atoi(w.Header().Get("Retry-After")); err != nil || secs < 1 {
		t.Errorf("Retry-After = %q, want a positive number of seconds", w.Header().Get("Retry-After"))
	}
	if !strings.Contains(w.Body.String(), `"error"`) {
		t.Errorf("a 429 should be JSON with an error, got %s", w.Body)
	}

	// The same address on another port is the same client; another address is not.
	if w := mintFrom(h, "203.0.113.1:2", freshStart()); w.Code != http.StatusTooManyRequests {
		t.Errorf("same address, new port: %d, want 429", w.Code)
	}
	if w := mintFrom(h, "203.0.113.2:1", freshStart()); w.Code != http.StatusCreated {
		t.Errorf("another client: %d, want 201", w.Code)
	}
}

func TestReplaysSpendTokens(t *testing.T) {
	h := newTestServerWith(t, Config{MintBurst: 2, MintEvery: time.Minute})
	start := freshStart()
	// One cookie jar for both, so the second request really is a replay.
	v := newVisitor(t, h)
	v.cookies = nil
	body := mintBody(0, start)
	if w := v.do(http.MethodPost, "/api/pours", body); w.Code != http.StatusCreated {
		t.Fatalf("first: %d", w.Code)
	}
	if w := v.do(http.MethodPost, "/api/pours", body); w.Code != http.StatusOK {
		t.Fatalf("replay: %d, want 200", w.Code)
	}
	if w := v.do(http.MethodPost, "/api/pours", body); w.Code != http.StatusTooManyRequests {
		t.Errorf("a replay past the burst: %d, want 429", w.Code)
	}
}

func TestReadsAreNotRateLimited(t *testing.T) {
	h := newTestServerWith(t, Config{MintBurst: 1, MintEvery: time.Hour})
	v := newVisitor(t, h)
	for i := 0; i < 20; i++ {
		if w := v.do(http.MethodGet, "/api/pours", ""); w.Code != http.StatusOK {
			t.Fatalf("list %d: %d", i+1, w.Code)
		}
	}
}

func TestNoLimitUnlessConfigured(t *testing.T) {
	h := newTestServerWith(t, Config{})
	for i := 0; i < 20; i++ {
		if w := mintFrom(h, "203.0.113.1:1", freshStart()); w.Code != http.StatusCreated {
			t.Fatalf("mint %d: %d", i+1, w.Code)
		}
	}
}
