package httpapi

import (
	"context"
	"crypto/rand"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"
)

// middleware runs around every route. The list is innermost first, so a
// request passes through nosniff, requestID, accessLog, recoverer, then the mux.
//
// The order is load-bearing. requestID is outside everything that logs, so every
// line below it — the access line, a recovered panic, the handler's own
// "minted" — carries the same id. accessLog is outside recoverer so a panic
// that became a 500 is still logged as a 500, rather than as nothing.
func (s *Server) middleware(h http.Handler) http.Handler {
	for _, m := range []func(http.Handler) http.Handler{
		s.recoverer,
		s.accessLog,
		s.requestID,
		nosniff,
	} {
		h = m(h)
	}
	return h
}

type logKey struct{}

// logFor is the logger for one request: the server's, plus its request id.
// Handlers log through this rather than s.log, or the lines worth tracing —
// minted, mint replayed, overclaim — are the ones without an id.
func (s *Server) logFor(r *http.Request) *slog.Logger {
	if l, ok := r.Context().Value(logKey{}).(*slog.Logger); ok {
		return l
	}
	return s.log
}

// requestID honours an X-Request-Id from a proxy in front, so its logs and
// these join up, and mints one otherwise. A forwarded id goes into every log
// line, so only a short, plain one is trusted; anything else is replaced.
func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if !plainID(id) {
			id = rand.Text()
		}
		w.Header().Set("X-Request-Id", id)
		ctx := context.WithValue(r.Context(), logKey{}, s.log.With("requestId", id))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func plainID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, c := range id {
		ok := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.'
		if !ok {
			return false
		}
	}
	return true
}

// accessLog writes one line per request. It logs from a defer so that a
// request aborted by a re-raised panic is still recorded on its way out.
func (s *Server) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w}
		start := time.Now()
		defer func() {
			s.logFor(r).Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				// The peer is the proxy when there is one; clientIp is the
				// visitor. Logging both is how a deployment learns which
				// addresses to list in MOLTENPOUR_TRUSTED_PROXIES.
				"peer", s.sessions.Peer(r),
				"clientIp", s.sessions.ClientIP(r),
				"status", rec.status(),
				"durationMs", time.Since(start).Milliseconds(),
			)
		}()
		next.ServeHTTP(rec, r)
	})
}

// statusRecorder remembers the status a handler sent. A handler that only
// calls Write has sent 200, and one that sent nothing at all also gets 200
// from net/http, so that is what an unset code means.
type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (rec *statusRecorder) WriteHeader(code int) {
	if rec.code == 0 {
		rec.code = code
	}
	rec.ResponseWriter.WriteHeader(code)
}

func (rec *statusRecorder) Write(b []byte) (int, error) {
	if rec.code == 0 {
		rec.code = http.StatusOK
	}
	return rec.ResponseWriter.Write(b)
}

func (rec *statusRecorder) status() int {
	if rec.code == 0 {
		return http.StatusOK
	}
	return rec.code
}

// Unwrap lets http.ResponseController reach the real writer through this one.
func (rec *statusRecorder) Unwrap() http.ResponseWriter { return rec.ResponseWriter }

// recoverer turns a panicking handler into a logged 500 instead of a dropped
// connection, which the client cannot tell from a network failure.
//
// Two panics are passed on rather than handled. http.ErrAbortHandler is how a
// handler asks net/http to abort on purpose. And once the status line is out a
// 500 can no longer be sent, so a clean-looking truncated body would be the
// worst answer: re-raising as ErrAbortHandler makes net/http cut the
// connection, which the client sees as the failure it is.
func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			if v == http.ErrAbortHandler {
				panic(v)
			}
			s.logFor(r).Error("handler panicked", "panic", v, "stack", string(debug.Stack()))
			if rec, ok := w.(*statusRecorder); ok && rec.code != 0 {
				panic(http.ErrAbortHandler)
			}
			s.writeErr(w, http.StatusInternalServerError, "internal error")
		}()
		next.ServeHTTP(w, r)
	})
}

// nosniff stops a browser from second-guessing a Content-Type — a JSON error
// body rendered as HTML, say.
func nosniff(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}
