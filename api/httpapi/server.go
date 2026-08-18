// Package httpapi exposes the pour ledger over HTTP.
package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"moltenpour/api/pour"
	"moltenpour/api/session"
)

type Server struct {
	store    pour.Store
	sessions *session.Manager
	log      *slog.Logger
	now      func() time.Time
}

func New(store pour.Store, sessions *session.Manager, log *slog.Logger) *Server {
	return &Server{store: store, sessions: sessions, log: log, now: time.Now}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/pours", s.handleMint)
	mux.HandleFunc("GET /api/pours", s.handleList)
	mux.HandleFunc("GET /api/pours/{id}", s.handleGet)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		s.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	return mux
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

	// TODO(payment): receipt validation is stubbed — a paid tier would be
	// verified against the store receipt here, before anything is minted.
	// Until then every tierIndex>0 request mints for free. Logged at Warn,
	// not Debug, because this is a standing gap, not routine traffic: sigils
	// are meant to only mint on a validated receipt, which is what makes the
	// max-legal-claim exploit cost real money per attempt.
	if req.TierIndex > 0 {
		s.log.Warn("minting a paid tier with receipt validation stubbed", "tierIndex", req.TierIndex)
	}

	now := s.now()
	rec, err := s.store.Append(func(position int) (pour.Record, error) {
		// ownerID comes from the signed cookie, never from the request body.
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
		s.log.Error("minting a pour", "err", err)
		s.writeErr(w, http.StatusInternalServerError, "could not mint the pour")
		return
	}

	// The escalation triggers at the bottom of app/sigil/telemetry.ts are stated
	// as rates -- violations on >2% of pours, Singular share on tiers 3-5 above
	// twice the modeled rate. Neither is measurable unless every violation is
	// logged, so this line is what makes the accepted risk reviewable rather than
	// merely accepted.
	if len(rec.Violations) > 0 {
		s.log.Warn("telemetry overclaim",
			"pour", rec.ID,
			"tierIndex", rec.TierIndex,
			"violations", strings.Join(rec.Violations, ","),
			"rarity", rec.Rarity,
		)
	}
	s.log.Info("minted",
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
	records, err := s.store.List(ownerID)
	if err != nil {
		s.log.Error("listing the ledger", "err", err)
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
	rec, err := s.store.Get(r.PathValue("id"), ownerID)
	if errors.Is(err, pour.ErrNotFound) {
		s.writeErr(w, http.StatusNotFound, "no such pour")
		return
	}
	if err != nil {
		s.log.Error("reading a pour", "err", err)
		s.writeErr(w, http.StatusInternalServerError, "could not read the ledger")
		return
	}
	s.writeJSON(w, http.StatusOK, rec)
}
