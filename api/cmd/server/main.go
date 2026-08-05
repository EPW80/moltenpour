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
	"syscall"
	"time"

	"moltenpour/api/httpapi"
	"moltenpour/api/pour"
	"moltenpour/api/session"
)

func main() {
	addr := flag.String("addr", ":8787", "listen address")
	dbPath := flag.String("db", "moltenpour.db", `ledger file, or ":memory:" for an ephemeral one`)
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

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

	sessions := session.New(os.Getenv("MOLTENPOUR_SECRET"), log)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           httpapi.New(store, sessions, log).Routes(),
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
