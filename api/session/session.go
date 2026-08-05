// Package session identifies a visitor without asking them to become one.
//
// A pour belongs to whoever poured it, so the ledger needs an owner. It does not
// need a person: there is no login, no email, no password and no PII here. The
// product is an impulse purchase whose whole register is a ceremony, and opening
// that with a sign-up wall would cost more than the identity is worth.
//
// The owner id is a random opaque value carried in a signed cookie. Signing is
// what stops a visitor editing the cookie to read someone else's ledger — the id
// is the only thing standing between one collection and another.
//
// If real accounts are added later they can adopt these ids by claiming them,
// so nothing minted anonymously is orphaned.
package session

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

const (
	cookieName = "mp_owner"
	// Long-lived: the collection is the point of the product, and losing it
	// because a cookie expired would read as the ledger having been erased.
	cookieMaxAge = 400 * 24 * time.Hour
)

// devSecret is used when MOLTENPOUR_SECRET is unset. It is a fixed value on
// purpose — a random per-boot secret would silently invalidate every cookie on
// restart, which looks exactly like the persistence being broken.
const devSecret = "moltenpour-development-secret-do-not-use-in-production"

type Manager struct {
	secret []byte
	log    *slog.Logger
}

// New returns a Manager. An empty secret falls back to a known development value
// and says so loudly, because a deployment running on the default secret has
// cookies anyone can forge.
func New(secret string, log *slog.Logger) *Manager {
	if secret == "" {
		log.Warn("MOLTENPOUR_SECRET is unset — using the development signing secret; owner cookies are forgeable")
		secret = devSecret
	}
	return &Manager{secret: []byte(secret), log: log}
}

func (m *Manager) sign(id string) string {
	mac := hmac.New(sha256.New, m.secret)
	mac.Write([]byte(id))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// parse returns the owner id from a cookie value, or "" if it does not verify.
func (m *Manager) parse(value string) string {
	id, sig, ok := strings.Cut(value, ".")
	if !ok || id == "" {
		return ""
	}
	// Constant time: a timing oracle here would leak the signature a byte at a
	// time, and the signature is the whole access control.
	if !hmac.Equal([]byte(sig), []byte(m.sign(id))) {
		return ""
	}
	return id
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// OwnerID returns the visitor's owner id, minting and setting one when the
// request arrives without a valid cookie.
//
// A tampered or unsigned cookie is treated exactly like no cookie: the visitor
// silently becomes a new owner with an empty collection. There is nothing to
// tell them — they were never anyone in the first place.
func (m *Manager) OwnerID(w http.ResponseWriter, r *http.Request) (string, error) {
	if c, err := r.Cookie(cookieName); err == nil {
		if id := m.parse(c.Value); id != "" {
			return id, nil
		}
	}

	id, err := newID()
	if err != nil {
		return "", err
	}
	http.SetCookie(w, &http.Cookie{
		Name:  cookieName,
		Value: id + "." + m.sign(id),
		Path:  "/",
		// No script needs to read this, and one that could would be able to lift
		// a visitor's whole collection.
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		// Only over TLS when the request itself arrived over TLS, so this still
		// works on a plain-HTTP localhost.
		Secure:  r.TLS != nil,
		Expires: time.Now().Add(cookieMaxAge),
		MaxAge:  int(cookieMaxAge.Seconds()),
	})
	return id, nil
}
