package httpapi

import (
	"encoding/json"
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

// A server whose log lands in buf, for the tests that read what was logged.
func newLoggedServer(t *testing.T, buf io.Writer) *Server {
	t.Helper()
	store, err := pour.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	log := slog.New(slog.NewTextHandler(buf, nil))
	s := New(store, session.New("test-secret", false, log), log, Config{MaxTierIndex: pour.MaxTierIndex})
	s.now = func() time.Time { return now }
	return s
}

func serve(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

// A panic must come back as the JSON 500 the client knows how to read — not a
// dropped connection it would take for the network — and be logged, with its
// stack and the request's id, as a 500 in the access log too.
func TestPanicBecomesAJSON500(t *testing.T) {
	var buf strings.Builder
	s := newLoggedServer(t, &buf)
	h := s.middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))

	w := serve(h, httptest.NewRequest(http.MethodGet, "/api/pours", nil))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("got %d, want 500", w.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body["error"] == "" {
		t.Fatalf("500 body is not a JSON error: %q", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "boom") {
		t.Fatalf("the panic value reached the client: %q", w.Body.String())
	}

	id := w.Header().Get("X-Request-Id")
	logged := buf.String()
	for _, want := range []string{
		`msg="handler panicked"`, "panic=boom", "middleware_test.go", // the stack names the panicking frame
		"msg=request", "status=500", "requestId=" + id,
	} {
		if !strings.Contains(logged, want) {
			t.Errorf("log is missing %q:\n%s", want, logged)
		}
	}
}

// Once the status line is out a 500 cannot be sent. Re-raising as
// ErrAbortHandler makes net/http cut the connection, so the client cannot take
// a truncated body for a complete one — and the access log still records it.
func TestPanicAfterTheHeaderAbortsTheConnection(t *testing.T) {
	var buf strings.Builder
	s := newLoggedServer(t, &buf)
	h := s.middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"partial":`))
		panic("boom")
	}))

	defer func() {
		if v := recover(); v != http.ErrAbortHandler {
			t.Fatalf("recovered %v, want http.ErrAbortHandler", v)
		}
		if !strings.Contains(buf.String(), "msg=request") || !strings.Contains(buf.String(), "status=200") {
			t.Errorf("aborted request missing from the access log:\n%s", buf.String())
		}
	}()
	serve(h, httptest.NewRequest(http.MethodGet, "/api/pours", nil))
}

// ErrAbortHandler is a deliberate abort, not a fault: passed through, not
// reported as a panic.
func TestDeliberateAbortIsPassedThrough(t *testing.T) {
	var buf strings.Builder
	s := newLoggedServer(t, &buf)
	h := s.middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	}))

	defer func() {
		if v := recover(); v != http.ErrAbortHandler {
			t.Fatalf("recovered %v, want http.ErrAbortHandler", v)
		}
		if strings.Contains(buf.String(), "handler panicked") {
			t.Errorf("a deliberate abort was logged as a panic:\n%s", buf.String())
		}
	}()
	serve(h, httptest.NewRequest(http.MethodGet, "/api/pours", nil))
}

func TestRequestIDIsMintedOrForwarded(t *testing.T) {
	h := newTestServer(t)
	health := func(id string) string {
		r := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		if id != "" {
			r.Header.Set("X-Request-Id", id)
		}
		return serve(h, r).Header().Get("X-Request-Id")
	}

	first, second := health(""), health("")
	if first == "" || first == second {
		t.Fatalf("minted ids %q and %q, want two distinct non-empty ids", first, second)
	}
	if got := health("edge-7f3a.01_b"); got != "edge-7f3a.01_b" {
		t.Fatalf("a proxy's id came back as %q", got)
	}
	// It goes into every log line, so anything but a short plain token is replaced.
	for _, bad := range []string{"two\nlines", `quote"d`, "a b", strings.Repeat("x", 65)} {
		if got := health(bad); got == bad || got == "" {
			t.Errorf("forwarded id %q came back as %q, want a fresh one", bad, got)
		}
	}
}

// The point of the id: the handler's own lines carry it, so a mint can be
// traced from the access log to the ledger and back.
func TestHandlerLinesCarryTheRequestID(t *testing.T) {
	var buf strings.Builder
	v := newVisitor(t, newLoggedServer(t, &buf).Routes())

	w := v.do(http.MethodPost, "/api/pours", mintBody(2, freshStart()))
	if w.Code != http.StatusCreated {
		t.Fatalf("mint: got %d, body %s", w.Code, w.Body.String())
	}

	id := w.Header().Get("X-Request-Id")
	var minted, access string
	for line := range strings.SplitSeq(buf.String(), "\n") {
		switch {
		case strings.Contains(line, "msg=minted"):
			minted = line
		case strings.Contains(line, "msg=request"):
			access = line
		}
	}
	if !strings.Contains(minted, "requestId="+id) {
		t.Errorf("minted line lacks requestId=%s: %q", id, minted)
	}
	for _, want := range []string{"requestId=" + id, "method=POST", "path=/api/pours", "status=201", "durationMs="} {
		if !strings.Contains(access, want) {
			t.Errorf("access line lacks %q: %q", want, access)
		}
	}
}

// A handler that writes a body without calling WriteHeader has sent a 200, and
// one that writes nothing at all has too. Neither may be logged as status 0.
func TestAccessLogRecordsAnImplicit200(t *testing.T) {
	for name, handler := range map[string]http.HandlerFunc{
		"write only": func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) },
		"nothing":    func(http.ResponseWriter, *http.Request) {},
	} {
		t.Run(name, func(t *testing.T) {
			var buf strings.Builder
			s := newLoggedServer(t, &buf)
			serve(s.middleware(handler), httptest.NewRequest(http.MethodGet, "/x", nil))
			if !strings.Contains(buf.String(), "status=200") {
				t.Fatalf("want status=200 in the access line:\n%s", buf.String())
			}
		})
	}
}

func TestEveryResponseIsNosniff(t *testing.T) {
	h := newTestServer(t)
	for _, path := range []string{"/api/health", "/api/pours", "/api/no-such-thing"} {
		w := serve(h, httptest.NewRequest(http.MethodGet, path, nil))
		if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options = %q, want nosniff", path, got)
		}
	}
}
