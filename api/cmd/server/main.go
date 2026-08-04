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
)

func main() {
	addr := flag.String("addr", ":8787", "listen address")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	// In-memory: the ledger does not survive a restart. Swap in a Postgres-backed
	// pour.Store when it needs to; nothing in httpapi reads the concrete type.
	srv := &http.Server{
		Addr:              *addr,
		Handler:           httpapi.New(pour.NewMemoryStore(), log).Routes(),
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
