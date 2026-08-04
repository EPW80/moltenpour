package pour

import (
	"errors"
	"sync"
)

var ErrNotFound = errors.New("pour not found")

// Store is the pour ledger.
//
// An interface with one in-memory implementation, so a Postgres-backed ledger
// can drop in without the handlers changing. Append owns ledger position
// specifically because that ordering is the thing a real database would need to
// assign transactionally.
type Store interface {
	// Append mints and records in one step. The store assigns the position.
	Append(mint func(ledgerPosition int) (Record, error)) (Record, error)
	Get(id string) (Record, error)
	List() []Record
}

type memoryStore struct {
	mu      sync.RWMutex
	records []Record
	byID    map[string]Record
}

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

func (s *memoryStore) Get(id string) (Record, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rec, ok := s.byID[id]
	if !ok {
		return Record{}, ErrNotFound
	}
	return rec, nil
}

func (s *memoryStore) List() []Record {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Newest first: the gallery shows the freshly minted pour top left.
	out := make([]Record, 0, len(s.records))
	for i := len(s.records) - 1; i >= 0; i-- {
		out = append(out, s.records[i])
	}
	return out
}
