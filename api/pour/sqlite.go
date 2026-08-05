package pour

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"moltenpour/api/sigil"

	_ "modernc.org/sqlite"
)

// The ledger, as columns rather than an opaque blob.
//
// The escalation triggers at the bottom of app/sigil/telemetry.ts are stated as
// rates over the ledger — violations on more than 2% of pours, Singular share on
// tiers 3-5 above twice the modeled rate. Those are questions someone has to be
// able to ask of this table, so the fields they are about are columns.
//
// ledger_position is UNIQUE and global rather than per-owner. "No. 1,284" is the
// Office's ledger, not the visitor's, and one continuous sequence is what makes
// the register read as institutional. serial is UNIQUE because it is derived
// from the position and a duplicate would mean the position logic broke.
const schema = `
CREATE TABLE IF NOT EXISTS pours (
	id              TEXT    PRIMARY KEY,
	owner_id        TEXT    NOT NULL,
	ledger_position INTEGER NOT NULL UNIQUE,
	tier_index      INTEGER NOT NULL,
	amount_cents    INTEGER NOT NULL,
	timestamp_ms    INTEGER NOT NULL,
	droplets_landed REAL    NOT NULL,
	peak_velocity   REAL    NOT NULL,
	tilt_energy     REAL    NOT NULL,
	hold_ms         REAL    NOT NULL,
	violations      TEXT    NOT NULL,
	seed            INTEGER NOT NULL,
	rarity          TEXT    NOT NULL,
	rarity_score    REAL    NOT NULL,
	serial          TEXT    NOT NULL UNIQUE,
	batch           TEXT    NOT NULL,
	mass_grams      REAL    NOT NULL,
	issued          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS pours_owner ON pours (owner_id, ledger_position DESC);
`

type sqliteStore struct {
	db *sql.DB
}

// NewSQLiteStore opens (and creates if needed) the ledger at path.
//
// Pass ":memory:" for an ephemeral one — used by the tests to exercise this
// implementation rather than only the in-memory map.
func NewSQLiteStore(path string) (Store, error) {
	// WAL so a reader is never blocked by the writer; busy_timeout so a
	// contended write waits rather than failing outright.
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open ledger: %w", err)
	}

	// One writer. SQLite serializes writes anyway, and holding the connection
	// count at one turns a class of SQLITE_BUSY races into ordinary waiting —
	// worth far more here than concurrency the ledger will never need.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("create ledger schema: %w", err)
	}
	return &sqliteStore{db: db}, nil
}

func (s *sqliteStore) Close() error { return s.db.Close() }

func (s *sqliteStore) Append(mint func(ledgerPosition int) (Record, error)) (Record, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	// Read the position and insert inside one transaction. The position feeds
	// the serial and the batch, so reading it outside would let two concurrent
	// pours print the same serial — the thing TestConcurrentAppendsGetUniqueSerials
	// exists to catch.
	var position int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(ledger_position), 0) + 1 FROM pours`).Scan(&position); err != nil {
		return Record{}, err
	}

	rec, err := mint(position)
	if err != nil {
		return Record{}, err
	}

	violations, err := json.Marshal(rec.Violations)
	if err != nil {
		return Record{}, err
	}

	if _, err := tx.Exec(`
		INSERT INTO pours (
			id, owner_id, ledger_position, tier_index, amount_cents, timestamp_ms,
			droplets_landed, peak_velocity, tilt_energy, hold_ms,
			violations, seed, rarity, rarity_score, serial, batch, mass_grams, issued
		) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		rec.ID, rec.OwnerID, rec.LedgerPosition, rec.TierIndex, rec.AmountCents, rec.TimestampMs,
		rec.Telemetry.DropletsLanded, rec.Telemetry.PeakVelocity, rec.Telemetry.TiltEnergy, rec.Telemetry.HoldMs,
		string(violations), int64(rec.Seed), string(rec.Rarity), rec.RarityScore,
		rec.Serial, rec.Batch, rec.MassGrams, rec.Issued,
	); err != nil {
		return Record{}, err
	}

	return rec, tx.Commit()
}

const selectColumns = `
	id, owner_id, ledger_position, tier_index, amount_cents, timestamp_ms,
	droplets_landed, peak_velocity, tilt_energy, hold_ms,
	violations, seed, rarity, rarity_score, serial, batch, mass_grams, issued
	FROM pours`

func scanRecord(scan func(...any) error) (Record, error) {
	var r Record
	var violations string
	var seed int64
	var rarity string

	if err := scan(
		&r.ID, &r.OwnerID, &r.LedgerPosition, &r.TierIndex, &r.AmountCents, &r.TimestampMs,
		&r.Telemetry.DropletsLanded, &r.Telemetry.PeakVelocity, &r.Telemetry.TiltEnergy, &r.Telemetry.HoldMs,
		&violations, &seed, &rarity, &r.RarityScore, &r.Serial, &r.Batch, &r.MassGrams, &r.Issued,
	); err != nil {
		return Record{}, err
	}

	r.Seed = uint32(seed)
	r.Rarity = sigil.Rarity(rarity)
	if err := json.Unmarshal([]byte(violations), &r.Violations); err != nil {
		return Record{}, err
	}
	// [] rather than null: the client iterates this, and JSON null there is the
	// same nil-vs-empty distinction that cost a cycle in the original Go port.
	if r.Violations == nil {
		r.Violations = []string{}
	}
	return r, nil
}

func (s *sqliteStore) Get(id, ownerID string) (Record, error) {
	// Owner is part of the WHERE, not a check afterwards. Someone else's pour is
	// ErrNotFound: whether a serial exists is not public information.
	row := s.db.QueryRow(`SELECT `+selectColumns+` WHERE id = ? AND owner_id = ?`, id, ownerID)
	rec, err := scanRecord(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	return rec, err
}

func (s *sqliteStore) List(ownerID string) ([]Record, error) {
	rows, err := s.db.Query(`SELECT `+selectColumns+` WHERE owner_id = ? ORDER BY ledger_position DESC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Non-nil so the handler encodes [] rather than null for an empty collection.
	out := []Record{}
	for rows.Next() {
		rec, err := scanRecord(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}
