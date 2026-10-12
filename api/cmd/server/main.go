// Command server runs the MoltenPour API.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"moltenpour/api/httpapi"
	"moltenpour/api/pour"
	"moltenpour/api/session"
)

func main() {
	addr := flag.String("addr", defaultAddr(), "listen address; defaults to :$PORT, else :8787")
	dbPath := flag.String("db", "moltenpour.db", `ledger file, or ":memory:" for an ephemeral one`)
	staticDir := flag.String("static", "", "directory of the built SPA to serve; empty serves the API alone")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	// Paid tiers mint for free while receipt validation is a stub, so the
	// default refuses them. A deployment that can charge raises this.
	maxTier := envInt("MOLTENPOUR_MAX_TIER", 0, log)
	if maxTier > pour.MaxTierIndex {
		maxTier = pour.MaxTierIndex
	}

	// Behind a TLS-terminating proxy the owner cookie needs X-Forwarded-Proto to
	// know it should be Secure. Opt in, because the header is forgeable anywhere
	// a proxy is not overwriting it.
	trustProxy := os.Getenv("MOLTENPOUR_TRUST_PROXY") == "1"

	// The ledger outlives the process. A certificate's serial and ledger position
	// are derived from it, so losing the file re-issues No. 1 to somebody — for a
	// document whose entire register is institutional permanence.
	store, err := pour.NewSQLiteStore(*dbPath)
	if err != nil {
		log.Error("opening the ledger", "path", *dbPath, "err", err)
		os.Exit(1)
	}
	defer func() {
		if err := store.Close(); err != nil {
			log.Error("closing the ledger", "err", err)
		}
	}()
	log.Info("ledger open", "path", *dbPath)

	secret := os.Getenv("MOLTENPOUR_SECRET")
	if secret == "" && os.Getenv("MOLTENPOUR_ENV") == "production" {
		// session.New would fall back to the published dev secret and only warn —
		// fine for local development, not acceptable for a deployment that has
		// declared itself production. Refuse to hand out forgeable cookies.
		log.Error("MOLTENPOUR_SECRET is unset with MOLTENPOUR_ENV=production — refusing to start with a forgeable signing secret")
		os.Exit(1)
	}
	sessions := session.New(secret, trustProxy, log)

	// The precise form of MOLTENPOUR_TRUST_PROXY: forwarded headers are believed
	// only from a peer inside one of these CIDRs. The access log's `peer` field
	// shows what to list.
	proxies, err := session.ParseProxies(os.Getenv("MOLTENPOUR_TRUSTED_PROXIES"))
	if err != nil {
		log.Error("MOLTENPOUR_TRUSTED_PROXIES", "err", err)
		os.Exit(1)
	}
	sessions.SetTrustedProxies(proxies)
	switch {
	case trustProxy && len(proxies) > 0:
		log.Warn("MOLTENPOUR_TRUST_PROXY=1 trusts every peer and makes MOLTENPOUR_TRUSTED_PROXIES moot; unset it")
	case trustProxy:
		log.Warn("MOLTENPOUR_TRUST_PROXY=1 trusts every peer; prefer MOLTENPOUR_TRUSTED_PROXIES")
	case len(proxies) > 0:
		log.Info("trusting forwarded headers from", "proxies", proxies)
	}

	// Ten pours a minute from one address, in bursts of five. The burst has to
	// cover the client's two retries of a single mint, which count against it.
	cfg := httpapi.Config{
		MaxTierIndex: maxTier,
		StaticDir:    *staticDir,
		MintBurst:    5,
		MintEvery:    6 * time.Second,
	}
	if cfg.StaticDir != "" {
		log.Info("serving the app", "dir", cfg.StaticDir)
	}
	log.Info("tier ceiling", "maxTierIndex", cfg.MaxTierIndex)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           httpapi.New(store, sessions, log, cfg).Routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		// Above the ledger's 10s busy_timeout, so a mint that waits out a write
		// lock can still answer instead of being cut off mid-response.
		WriteTimeout:   15 * time.Second,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: 16 << 10,
	}

	go func() {
		log.Info("listening", "addr", *addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("shutdown", "err", err)
	}
	log.Info("stopped")
}

// defaultAddr honours $PORT, which is how every container host says where to
// listen. -addr still wins when it is given.
func defaultAddr() string {
	if p := os.Getenv("PORT"); p != "" {
		return ":" + p
	}
	return ":8787"
}

// envInt reads an integer setting, falling back loudly rather than silently: a
// typo in a deployment variable that quietly meant zero would be indistinguishable
// from meaning it.
func envInt(name string, fallback int, log *slog.Logger) int {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		log.Warn("ignoring unparseable setting", "name", name, "value", raw, "using", fallback)
		return fallback
	}
	return n
}
