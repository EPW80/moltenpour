// Package httpapi exposes the pour ledger over HTTP.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"moltenpour/api/pour"
	"moltenpour/api/session"
)

// Config is what the deployment decides, as opposed to what the ledger decides.
type Config struct {
	// MaxTierIndex is the highest tier this deployment will mint.
	//
	// Receipt validation is a stub (see handleMint), so every tier above 0 would
	// otherwise mint for free. A deployment that cannot charge says so here
	// rather than quietly giving away the paid ones.
	MaxTierIndex int

	// MintBurst and MintEvery rate-limit POST /api/pours per client address: a
	// bucket of MintBurst, refilled one every MintEvery. Zero disables it. A
	// replay of an already-minted pour spends a token like any other request,
	// so the burst must cover the client's retries (api.ts retries twice).
	MintBurst int
	MintEvery time.Duration

	// StaticDir is the built SPA. Empty serves the API alone, which is what the
	// Vite dev proxy expects.
	StaticDir string
}

type Server struct {
	store    pour.Store
	sessions *session.Manager
	log      *slog.Logger
	cfg      Config
	now      func() time.Time

	// mintLimit is nil when the deployment has not asked for a rate limit.
	mintLimit *limiter
}

func New(store pour.Store, sessions *session.Manager, log *slog.Logger, cfg Config) *Server {
	s := &Server{store: store, sessions: sessions, log: log, cfg: cfg, now: time.Now}
	if cfg.MintBurst > 0 && cfg.MintEvery > 0 {
		s.mintLimit = newLimiter(cfg.MintBurst, cfg.MintEvery)
	}
	return s
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/pours", s.handleMint)
	mux.HandleFunc("GET /api/pours", s.handleList)
	mux.HandleFunc("GET /api/pours/{id}", s.handleGet)
	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		s.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Readiness, unlike liveness above, asks the ledger. A deploy platform should
	// route on this and restart on /api/health.
	mux.HandleFunc("GET /api/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.store.Ping(ctx); err != nil {
			s.log.Error("ledger not ready", "err", err)
			s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "ledger unavailable"})
			return
		}
		s.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// An unknown path under /api is a client bug, and the client parses every
	// response as JSON. Without this it would fall through to the SPA and fail
	// on a page of HTML instead of reading the status it was given.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		s.writeErr(w, http.StatusNotFound, "no such endpoint")
	})

	if s.cfg.StaticDir != "" {
		// Least specific pattern, so every /api route above still wins.
		mux.Handle("/", staticHandler(s.cfg.StaticDir))
	}
	return s.middleware(mux)
}

// handleConfig tells the client what this deployment will accept, so the tier
// picker can grey out what it cannot sell instead of letting someone pour for
// fifteen seconds and receive a 400.
func (s *Server) handleConfig(w http.ResponseWriter, _ *http.Request) {
	s.writeJSON(w, http.StatusOK, map[string]int{"maxTierIndex": s.cfg.MaxTierIndex})
}

func (s *Server) writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// The status line is already sent, so this can only be logged.
		s.log.Error("encoding response", "err", err)
	}
}

func (s *Server) writeErr(w http.ResponseWriter, code int, msg string) {
	s.writeJSON(w, code, map[string]string{"error": msg})
}

func (s *Server) handleMint(w http.ResponseWriter, r *http.Request) {
	if s.mintLimit != nil {
		ip := s.sessions.ClientIP(r)
		if ok, wait := s.mintLimit.allow(ip, s.now()); !ok {
			s.logFor(r).Warn("mint rate limited", "clientIp", ip)
			w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
			s.writeErr(w, http.StatusTooManyRequests, "too many pours in a short time; try again shortly")
			return
		}
	}

	// Before anything is read or written: the owner must be resolved first,
	// because SetCookie has to happen before the response body is committed.
	ownerID, err := s.sessions.OwnerID(w, r)
	if err != nil {
		s.writeErr(w, http.StatusInternalServerError, "could not establish a session")
		return
	}

	var req pour.Request
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		s.writeErr(w, http.StatusBadRequest, "malformed request: "+err.Error())
		return
	}

	// Receipt validation is stubbed. A paid tier would be verified against the
	// store receipt here, before anything is minted — sigils only mint on a
	// validated receipt, which is what makes the max-legal-claim exploit cost
	// real money per attempt.
	//
	// Until that exists, the ceiling stands in for it: the check is before
	// Append, so a rejected tier never takes a ledger position. Advancing the
	// sequence for a pour that was refused would put a gap in a register whose
	// whole claim is that it is continuous.
	if req.TierIndex > s.cfg.MaxTierIndex {
		s.writeErr(w, http.StatusBadRequest, "that tier is not available")
		return
	}
	if req.TierIndex > 0 {
		s.logFor(r).Warn("minting a paid tier with receipt validation stubbed", "tierIndex", req.TierIndex)
	}

	now := s.now()
	// ownerID comes from the signed cookie, never from the request body — in the
	// key as much as in the mint, or a client could replay into someone else's.
	key := pour.MintKey{OwnerID: ownerID, TimestampMs: req.TimestampMs, TierIndex: req.TierIndex}
	rec, replayed, err := s.store.Append(r.Context(), key, func(position int) (pour.Record, error) {
		return pour.Mint(req, position, ownerID, now)
	})
	if err != nil {
		// pour.ErrValidation means the request itself was bad — safe to echo.
		// Anything else is a store failure (disk, transaction, driver) and its
		// raw message must not reach the client.
		if errors.Is(err, pour.ErrValidation) {
			s.writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if errors.Is(err, pour.ErrConflict) {
			s.writeErr(w, http.StatusConflict, err.Error())
			return
		}
		s.logFor(r).Error("minting a pour", "err", err)
		s.writeErr(w, http.StatusInternalServerError, "could not mint the pour")
		return
	}

	// A retry of a pour already on the ledger — the first response was lost.
	// The stored record is canonical; this request's telemetry is ignored. It
	// gets its own line and skips the two below, because those feed the rate
	// escalations and a retried pour counted twice would skew both.
	if replayed {
		s.logFor(r).Info("mint replayed", "pour", rec.ID, "position", rec.LedgerPosition)
		s.writeJSON(w, http.StatusOK, rec)
		return
	}

	// The escalation triggers at the bottom of app/sigil/telemetry.ts are stated
	// as rates -- violations on >2% of pours, Singular share on tiers 3-5 above
	// twice the modeled rate. Neither is measurable unless every violation is
	// logged, so this line is what makes the accepted risk reviewable rather than
	// merely accepted.
	if len(rec.Violations) > 0 {
		s.logFor(r).Warn("telemetry overclaim",
			"pour", rec.ID,
			"tierIndex", rec.TierIndex,
			"violations", strings.Join(rec.Violations, ","),
			"rarity", rec.Rarity,
		)
	}
	s.logFor(r).Info("minted",
		"pour", rec.ID,
		"position", rec.LedgerPosition,
		"tierIndex", rec.TierIndex,
		"rarity", rec.Rarity,
		"score", rec.RarityScore,
	)

	s.writeJSON(w, http.StatusCreated, rec)
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	ownerID, err := s.sessions.OwnerID(w, r)
	if err != nil {
		s.writeErr(w, http.StatusInternalServerError, "could not establish a session")
		return
	}
	records, err := s.store.List(r.Context(), ownerID)
	if err != nil {
		s.logFor(r).Error("listing the ledger", "err", err)
		s.writeErr(w, http.StatusInternalServerError, "could not read the ledger")
		return
	}
	s.writeJSON(w, http.StatusOK, records)
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	ownerID, err := s.sessions.OwnerID(w, r)
	if err != nil {
		s.writeErr(w, http.StatusInternalServerError, "could not establish a session")
		return
	}

	// Someone else's pour is indistinguishable from one that does not exist.
	// A 403 here would confirm the serial is real to anyone who guessed it.
	rec, err := s.store.Get(r.Context(), r.PathValue("id"), ownerID)
	if errors.Is(err, pour.ErrNotFound) {
		s.writeErr(w, http.StatusNotFound, "no such pour")
		return
	}
	if err != nil {
		s.logFor(r).Error("reading a pour", "err", err)
		s.writeErr(w, http.StatusInternalServerError, "could not read the ledger")
		return
	}
	s.writeJSON(w, http.StatusOK, rec)
}
