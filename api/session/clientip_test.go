package session

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func req(remote string, xff ...string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = remote
	for _, h := range xff {
		r.Header.Add("X-Forwarded-For", h)
	}
	return r
}

func TestClientIP(t *testing.T) {
	proxies, err := ParseProxies("172.16.0.0/12, fdaa::/16")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name       string
		trustProxy bool
		proxies    bool
		r          *http.Request
		want       string
	}{
		{name: "no proxy, no header", r: req("203.0.113.9:5000"), want: "203.0.113.9"},
		{
			name: "forwarded header from an untrusted peer is ignored",
			r:    req("203.0.113.9:5000", "198.51.100.1"), want: "203.0.113.9",
		},
		{
			name:    "cidr: proxy peer, visitor from the header",
			proxies: true, r: req("172.16.3.4:80", "198.51.100.1"), want: "198.51.100.1",
		},
		{
			name:    "cidr: a spoofed left entry loses to the real one on the right",
			proxies: true, r: req("172.16.3.4:80", "1.1.1.1, 198.51.100.1"), want: "198.51.100.1",
		},
		{
			name:    "cidr: inner trusted hops are skipped",
			proxies: true, r: req("172.16.3.4:80", "198.51.100.1, 172.16.9.9"), want: "198.51.100.1",
		},
		{
			name:    "cidr: ipv6 proxy peer",
			proxies: true, r: req("[fdaa::2]:80", "198.51.100.1"), want: "198.51.100.1",
		},
		{
			name:    "cidr: trusted peer with no header falls back to the peer",
			proxies: true, r: req("172.16.3.4:80"), want: "172.16.3.4",
		},
		{
			name:    "cidr: garbage in the header falls back to the peer",
			proxies: true, r: req("172.16.3.4:80", "not-an-ip"), want: "172.16.3.4",
		},
		{
			name:       "trustProxy alone is one hop: rightmost, not the forgeable left",
			trustProxy: true, r: req("10.9.9.9:80", "1.1.1.1, 198.51.100.1"), want: "198.51.100.1",
		},
		{
			name:    "header split across lines is read as one list",
			proxies: true, r: req("172.16.3.4:80", "1.1.1.1", "198.51.100.1"), want: "198.51.100.1",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := New("s", tc.trustProxy, quiet())
			if tc.proxies {
				m.SetTrustedProxies(proxies)
			}
			if got := m.ClientIP(tc.r); got != tc.want {
				t.Errorf("ClientIP = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestTrustedProxiesDecideSecure(t *testing.T) {
	proxies, _ := ParseProxies("172.16.0.0/12")
	for _, tc := range []struct {
		name   string
		remote string
		want   bool
	}{
		{"proxy peer, https", "172.16.0.5:80", true},
		{"other peer claiming https is not evidence", "203.0.113.9:80", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := New("s", false, quiet())
			m.SetTrustedProxies(proxies)
			r := req(tc.remote)
			r.Header.Set("X-Forwarded-Proto", "https")
			if got := m.overTLS(r); got != tc.want {
				t.Errorf("overTLS = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestParseProxies(t *testing.T) {
	got, err := ParseProxies(" 10.0.0.0/8 ,, 192.0.2.7 ,fd00::/8")
	if err != nil || len(got) != 3 {
		t.Fatalf("got %v, %v", got, err)
	}
	if got[1].String() != "192.0.2.7/32" {
		t.Errorf("a bare address should become a /32, got %s", got[1])
	}
	if got, err := ParseProxies(""); err != nil || len(got) != 0 {
		t.Errorf("empty list should be valid and empty, got %v, %v", got, err)
	}
	if _, err := ParseProxies("10.0.0.0/8, nonsense"); err == nil {
		t.Error("expected an error for a malformed entry")
	}
}
