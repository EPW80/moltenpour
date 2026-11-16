// Command server runs the MoltenPour API.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
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
	backupPath := flag.String("backup", "", "export a consistent SQLite snapshot to a new file, then exit")
	verifyPath := flag.String("verify-backup", "", "check an existing SQLite snapshot, then exit")
	auditPath := flag.String("audit", "", "read the ledger and report the escalation signals, then exit")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if *backupPath != "" || *verifyPath != "" || *auditPath != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := runOneShot(ctx, *dbPath, *backupPath, *verifyPath, *auditPath, log); err != nil {
			log.Error("operation failed", "err", err)
			os.Exit(1)
		}
		log.Info("operation completed")
		return
	}

	// Paid tiers mint for free while receipt validation is a stub, so the
	// default refuses them. A deployment that can charge raises this.
	maxTier := clampTierCeiling(envInt("MOLTENPOUR_MAX_TIER", 0, log), log)

	secret := os.Getenv("MOLTENPOUR_SECRET")
	if err := validateProduction(os.Getenv("MOLTENPOUR_ENV"), secret, maxTier); err != nil {
		log.Error("unsafe production configuration", "err", err)
		os.Exit(1)
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

	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Error("binding server", "err", err)
		os.Exit(1)
	}
	// The rehearsal uses this process's log to establish that it owns the port.
	// Emit only after binding, including the assigned port when -addr ends in :0.
	log.Info("listening", "addr", listener.Addr().String())
	go func() {
		if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
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

// clampTierCeiling keeps a deployment's tier ceiling inside what the ledger can
// mint, at both ends. A ceiling above the ledger is clamped. One below zero is
// floored to zero — "negative tiers" has no meaning, and passing a negative
// ceiling through would disable even the free tier (handleMint rejects anything
// above the ceiling), so a typo must not silently brick the one tier that costs
// nothing.
func clampTierCeiling(n int, log *slog.Logger) int {
	if n < 0 {
		log.Warn("tier ceiling below zero; flooring to 0", "value", n)
		return 0
	}
	if n > pour.MaxTierIndex {
		log.Warn("tier ceiling above the ledger maximum; clamping", "value", n, "max", pour.MaxTierIndex)
		return pour.MaxTierIndex
	}
	return n
}

func validateProduction(environment, secret string, maxTier int) error {
	if environment != "production" {
		return nil
	}
	if secret == "" || secret == "moltenpour-development-secret-do-not-use-in-production" {
		return fmt.Errorf("production requires a private MOLTENPOUR_SECRET")
	}
	if maxTier > 0 {
		return fmt.Errorf("production paid tiers require receipt validation; set MOLTENPOUR_MAX_TIER=0")
	}
	return nil
}

// runOneShot carries out a single -backup, -verify-backup, or -audit operation
// and returns its error. Exactly one path may be set; the three share the
// read-only ledger access and the two-minute timeout.
func runOneShot(ctx context.Context, dbPath, backupPath, verifyPath, auditPath string, log *slog.Logger) error {
	set := 0
	for _, p := range []string{backupPath, verifyPath, auditPath} {
		if p != "" {
			set++
		}
	}
	if set != 1 {
		return fmt.Errorf("use exactly one of -backup, -verify-backup, -audit")
	}
	switch {
	case backupPath != "":
		if err := pour.SnapshotSQLite(ctx, dbPath, backupPath); err != nil {
			return err
		}
		log.Info("backup verified")
	case verifyPath != "":
		if err := pour.VerifySQLite(ctx, verifyPath); err != nil {
			return err
		}
		log.Info("snapshot verified")
	case auditPath != "":
		report, err := pour.Audit(ctx, auditPath)
		if err != nil {
			return err
		}
		printAudit(report)
		if alarms := report.Alarms(); len(alarms) > 0 {
			return fmt.Errorf("ledger audit alarms: %s", strings.Join(alarms, "; "))
		}
	}
	return nil
}

func printAudit(r pour.AuditReport) {
	fmt.Printf("pours             %d\n", r.Total)
	fmt.Printf("highest position  %d\n", r.HighestPosition)
	fmt.Printf("violation rate    %.2f%% (%d of %d)\n", r.ViolationRate()*100, r.Violations, r.Total)
	fmt.Printf("singular (t3-5)   %.2f%% (%d of %d)\n", r.SingularShare()*100, r.Singular345, r.Tiers345)
	for _, tc := range r.Tiers {
		fmt.Printf("  tier %d          %d\n", tc.Tier, tc.Count)
	}
}
