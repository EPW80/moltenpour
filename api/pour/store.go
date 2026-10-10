package pour

import (
	"context"
	"errors"
	"sync"
)

var ErrNotFound = errors.New("pour not found")

// ErrConflict means a pour already exists at this owner and start time but
// under a different tier. That is not a retry of the same pour, and minting it
// would put two certificates on one pour-start.
var ErrConflict = errors.New("a different pour was already minted at this start time")

// MintKey identifies one pour independently of the ledger position it lands at.
//
// A retry resends the same timestampMs — the client keeps its pour-start until
// the pour is discarded — and one owner cannot start two pours in the same
// millisecond, so (OwnerID, TimestampMs) is the natural idempotency key.
// TierIndex is carried so a replay that disagrees about the tier is refused
// rather than silently answered with the other pour.
type MintKey struct {
	OwnerID     string
	TimestampMs int64
	TierIndex   int
}

// Store is the pour ledger.
//
// Every read is scoped to an owner. A pour belonging to someone else must come
// back as ErrNotFound rather than a permission error: whether a given serial
// exists at all is not public information, and a 403 would confirm it.
//
// The ledger POSITION is deliberately not per-owner — see the comment on the
// SQLite implementation.
type Store interface {
	// Append mints and records in one step. The store assigns the position.
	//
	// If a pour already exists at key, mint is not called: the stored record
	// comes back with replayed=true, or ErrConflict if its tier differs. The
	// lookup runs before mint, so a replay arriving after the clock-skew window
	// still returns the original rather than failing validation.
	Append(ctx context.Context, key MintKey, mint func(ledgerPosition int) (Record, error)) (rec Record, replayed bool, err error)
	Get(ctx context.Context, id, ownerID string) (Record, error)
	List(ctx context.Context, ownerID string) ([]Record, error)
	Close() error
}

// startKey is MintKey without the tier: the uniqueness the ledger enforces.
type startKey struct {
	ownerID     string
	timestampMs int64
}

type memoryStore struct {
	mu      sync.RWMutex
	records []Record
	byID    map[string]Record
	byStart map[startKey]Record
}

// NewMemoryStore is the ledger the tests run against, and the fallback when no
// database file is wanted. It does not survive a restart.
func NewMemoryStore() Store {
	return &memoryStore{byID: map[string]Record{}, byStart: map[startKey]Record{}}
}

func (s *memoryStore) Append(_ context.Context, key MintKey, mint func(ledgerPosition int) (Record, error)) (Record, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// The lookup shares the lock with the mint, or two concurrent retries of
	// one pour would both miss and both mint.
	sk := startKey{key.OwnerID, key.TimestampMs}
	if existing, ok := s.byStart[sk]; ok {
		if existing.TierIndex != key.TierIndex {
			return Record{}, false, ErrConflict
		}
		return existing, true, nil
	}

	// Position is assigned under the lock and the record is minted inside it,
	// because the position feeds the serial and the batch. Handing a position out
	// and minting afterwards would let two concurrent pours print the same serial.
	position := len(s.records) + 1
	rec, err := mint(position)
	if err != nil {
		return Record{}, false, err
	}

	s.records = append(s.records, rec)
	s.byID[rec.ID] = rec
	s.byStart[sk] = rec
	return rec, false, nil
}

func (s *memoryStore) Get(_ context.Context, id, ownerID string) (Record, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rec, ok := s.byID[id]
	if !ok || rec.OwnerID != ownerID {
		return Record{}, ErrNotFound
	}
	return rec, nil
}

func (s *memoryStore) List(_ context.Context, ownerID string) ([]Record, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Newest first: the gallery shows the freshly minted pour top left.
	out := make([]Record, 0, len(s.records))
	for i := len(s.records) - 1; i >= 0; i-- {
		if s.records[i].OwnerID == ownerID {
			out = append(out, s.records[i])
		}
	}
	return out, nil
}

func (s *memoryStore) Close() error { return nil }
