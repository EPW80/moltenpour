package pour

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
)

// openExistingSQLite never creates a missing ledger or runs schema migrations.
func openExistingSQLite(path string) (*sql.DB, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: abs, RawQuery: "mode=ro&_pragma=busy_timeout(10000)"}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

// SnapshotSQLite exports a consistent, standalone database while the writer
// remains online. VACUUM INTO includes committed WAL contents in the snapshot.
// Failed exports are retained for diagnosis; an existing destination is refused.
func SnapshotSQLite(ctx context.Context, source, destination string) error {
	db, err := openExistingSQLite(source)
	if err != nil {
		return fmt.Errorf("open snapshot source: %w", err)
	}
	defer db.Close()
	var position int
	if err := db.QueryRowContext(ctx, `SELECT COALESCE(MAX(ledger_position), 0) FROM pours`).Scan(&position); err != nil {
		return fmt.Errorf("read snapshot source: %w", err)
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("reserve snapshot destination: %w", err)
	}
	if err := file.Close(); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `VACUUM INTO ?`, destination); err != nil {
		return fmt.Errorf("export snapshot (partial file retained): %w", err)
	}
	return VerifySQLite(ctx, destination)
}

// VerifySQLite checks every integrity result and proves this is a pour ledger.
func VerifySQLite(ctx context.Context, path string) error {
	db, err := openExistingSQLite(path)
	if err != nil {
		return err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, `PRAGMA integrity_check`)
	if err != nil {
		return fmt.Errorf("check snapshot integrity: %w", err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var result string
		if err := rows.Scan(&result); err != nil {
			return err
		}
		if result != "ok" {
			return fmt.Errorf("snapshot integrity: %s", result)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close() // release the single connection before querying the ledger
	if count != 1 {
		return fmt.Errorf("snapshot integrity returned %d results, expected one", count)
	}
	var position int
	if err := db.QueryRowContext(ctx, `SELECT COALESCE(MAX(ledger_position), 0) FROM pours`).Scan(&position); err != nil {
		return fmt.Errorf("read snapshot ledger: %w", err)
	}
	return nil
}
