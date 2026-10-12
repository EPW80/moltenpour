package httpapi

import (
	"sync"
	"time"
)

// limiter is a per-key token bucket: each key holds up to burst tokens and
// regains one every `every`. It exists to put a price on minting, so it is keyed
// by client address and applied to POST /api/pours only.
type limiter struct {
	burst int
	every time.Duration

	mu      sync.Mutex
	buckets map[string]bucket
	swept   time.Time
}

type bucket struct {
	tokens float64
	at     time.Time
}

func newLimiter(burst int, every time.Duration) *limiter {
	return &limiter{burst: burst, every: every, buckets: map[string]bucket{}}
}

// allow takes a token for key. When it refuses, wait is how long until one is
// available.
func (l *limiter) allow(key string, now time.Time) (ok bool, wait time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Idle keys are full buckets and carry no information, so drop them rather
	// than let a scan of addresses grow the map without bound.
	if now.Sub(l.swept) > time.Minute {
		for k, b := range l.buckets {
			if b.tokens+float64(now.Sub(b.at))/float64(l.every) >= float64(l.burst) {
				delete(l.buckets, k)
			}
		}
		l.swept = now
	}

	b, seen := l.buckets[key]
	if !seen {
		b = bucket{tokens: float64(l.burst), at: now}
	}
	b.tokens = min(float64(l.burst), b.tokens+float64(now.Sub(b.at))/float64(l.every))
	b.at = now
	if b.tokens < 1 {
		l.buckets[key] = b
		return false, time.Duration((1 - b.tokens) * float64(l.every))
	}
	b.tokens--
	l.buckets[key] = b
	return true, 0
}
