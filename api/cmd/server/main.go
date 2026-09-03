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
	defer store.Close()
	log.Info("ledger open", "path", *dbPath)

	sessions := session.New(os.Getenv("MOLTENPOUR_SECRET"), trustProxy, log)

	cfg := httpapi.Config{MaxTierIndex: maxTier, StaticDir: *staticDir}
	if cfg.StaticDir != "" {
		log.Info("serving the app", "dir", cfg.StaticDir)
	}
	log.Info("tier ceiling", "maxTierIndex", cfg.MaxTierIndex)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           httpapi.New(store, sessions, log, cfg).Routes(),
		ReadHeaderTimeout: 5 * time.Second,
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

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
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
