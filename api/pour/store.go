package pour

import (
	"errors"
	"sync"
)

var ErrNotFound = errors.New("pour not found")

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
	Append(mint func(ledgerPosition int) (Record, error)) (Record, error)
	Get(id, ownerID string) (Record, error)
	List(ownerID string) ([]Record, error)
	Close() error
}

type memoryStore struct {
	mu      sync.RWMutex
	records []Record
	byID    map[string]Record
}

// NewMemoryStore is the ledger the tests run against, and the fallback when no
// database file is wanted. It does not survive a restart.
func NewMemoryStore() Store {
	return &memoryStore{byID: map[string]Record{}}
}

func (s *memoryStore) Append(mint func(ledgerPosition int) (Record, error)) (Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Position is assigned under the lock and the record is minted inside it,
	// because the position feeds the serial and the batch. Handing a position out
	// and minting afterwards would let two concurrent pours print the same serial.
	position := len(s.records) + 1
	rec, err := mint(position)
	if err != nil {
		return Record{}, err
	}

	s.records = append(s.records, rec)
	s.byID[rec.ID] = rec
	return rec, nil
}

func (s *memoryStore) Get(id, ownerID string) (Record, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rec, ok := s.byID[id]
	if !ok || rec.OwnerID != ownerID {
		return Record{}, ErrNotFound
	}
	return rec, nil
}

func (s *memoryStore) List(ownerID string) ([]Record, error) {
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
