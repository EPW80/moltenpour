package session

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// ParseProxies parses a comma-separated list of CIDRs (or bare addresses) naming
// the proxies whose X-Forwarded-* headers may be believed. Empty is valid and
// means none.
func ParseProxies(list string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, part := range strings.Split(list, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		p, err := netip.ParsePrefix(part)
		if err != nil {
			a, aerr := netip.ParseAddr(part)
			if aerr != nil {
				return nil, fmt.Errorf("%q is not a CIDR or an address", part)
			}
			p = netip.PrefixFrom(a.Unmap(), a.Unmap().BitLen())
		}
		out = append(out, p.Masked())
	}
	return out, nil
}

// SetTrustedProxies names the proxies whose forwarded headers are believed. A
// forwarded header is honoured only on a request whose TCP peer is inside one of
// them, because anyone can send the header and only a proxy overwrites it.
//
// This is the precise form of New's trustProxy flag, which trusts every peer.
func (m *Manager) SetTrustedProxies(p []netip.Prefix) { m.proxies = p }

func peerAddr(r *http.Request) (netip.Addr, bool) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	a, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, false
	}
	return a.Unmap(), true
}

func (m *Manager) inProxies(a netip.Addr) bool {
	for _, p := range m.proxies {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// fromProxy reports whether this request's forwarded headers may be believed.
func (m *Manager) fromProxy(r *http.Request) bool {
	if m.trustProxy {
		return true
	}
	a, ok := peerAddr(r)
	return ok && m.inProxies(a)
}

// Peer is the address of the TCP peer, which behind a proxy is the proxy.
func (m *Manager) Peer(r *http.Request) string {
	if a, ok := peerAddr(r); ok {
		return a.String()
	}
	return r.RemoteAddr
}

// ClientIP is the visitor's address as far as it can be established.
//
// Without a trusted proxy that is the TCP peer, and X-Forwarded-For is ignored.
// With trustProxy alone there is one proxy hop, so the entry that proxy appended
// — the rightmost — is the visitor; anything to its left was sent by the visitor
// and proves nothing. With CIDRs, entries are read from the right and trusted
// proxies are skipped; the first address that is not one is the visitor.
func (m *Manager) ClientIP(r *http.Request) string {
	peer := m.Peer(r)
	if !m.fromProxy(r) {
		return peer
	}
	var hops []string
	for _, h := range r.Header.Values("X-Forwarded-For") {
		hops = append(hops, strings.Split(h, ",")...)
	}
	for i := len(hops) - 1; i >= 0; i-- {
		a, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			return peer
		}
		a = a.Unmap()
		if m.trustProxy || !m.inProxies(a) {
			return a.String()
		}
	}
	return peer
}
