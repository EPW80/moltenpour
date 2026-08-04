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
)

type Server struct {
	store pour.Store
	log   *slog.Logger
	now   func() time.Time
}

func New(store pour.Store, log *slog.Logger) *Server {
	return &Server{store: store, log: log, now: time.Now}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/pours", s.handleMint)
	mux.HandleFunc("GET /api/pours", s.handleList)
	mux.HandleFunc("GET /api/pours/{id}", s.handleGet)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// The status line is already sent, so this can only be logged.
		slog.Error("encoding response", "err", err)
	}
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *Server) handleMint(w http.ResponseWriter, r *http.Request) {
	var req pour.Request
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed request: "+err.Error())
		return
	}

	// Receipt validation is stubbed. A paid tier would be verified against the
	// store receipt here, before anything is minted — sigils only mint on a
	// validated receipt, which is what makes the max-legal-claim exploit cost
	// real money per attempt.
	if req.TierIndex > 0 {
		s.log.Debug("receipt validation stubbed", "tierIndex", req.TierIndex)
	}

	now := s.now()
	rec, err := s.store.Append(func(position int) (pour.Record, error) {
		return pour.Mint(req, position, now)
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
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

	writeJSON(w, http.StatusCreated, rec)
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.store.List())
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	rec, err := s.store.Get(r.PathValue("id"))
	if errors.Is(err, pour.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "no such pour")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rec)
}
