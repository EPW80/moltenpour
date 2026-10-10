package httpapi

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// The built SPA, served by the same process as the API.
//
// Same origin is not a convenience here. The owner cookie is the whole access
// control (see package session) and the client fetches "/api/pours" with no
// base URL at all, so putting the app on a second origin would mean CORS,
// SameSite=None and credentialed fetches — three ways for a visitor's
// collection to silently become someone else's or nobody's.

// staticHandler serves dir, falling back to index.html for paths that name no
// file. Vite emits two real entry documents (index.html and proof.html) plus
// content-hashed assets, so the fallback exists for refreshes and stray paths
// only — proof.html still resolves as itself.
func staticHandler(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	index := filepath.Join(dir, "index.html")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := path.Clean("/" + r.URL.Path)

		// Content-hashed, so the name changes whenever the bytes do. Everything
		// else is either an entry document or the fallback, and a cached
		// index.html pointing at last deploy's assets is a blank page.
		if strings.HasPrefix(clean, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}

		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			if !fileExists(dir, clean) {
				// A missing asset is a broken deploy, not a route. Answering it
				// with index.html would hand JavaScript a page of HTML and turn a
				// 404 into a syntax error somewhere else entirely.
				if strings.HasPrefix(clean, "/assets/") {
					// Not immutable: a year-long cache on a miss would pin the
					// broken deploy in the visitor's browser past the fix.
					w.Header().Set("Cache-Control", "no-cache")
					http.NotFound(w, r)
					return
				}
				http.ServeFile(w, r, index)
				return
			}
		}
		files.ServeHTTP(w, r)
	})
}

// fileExists reports whether the cleaned URL path names a regular file under
// dir. Directories do not count: http.FileServer would answer them with a
// listing or a redirect to index.html, and neither is what a stray path means.
func fileExists(dir, clean string) bool {
	if clean == "/" {
		clean = "/index.html"
	}
	info, err := os.Stat(filepath.Join(dir, filepath.FromSlash(strings.TrimPrefix(clean, "/"))))
	return err == nil && info.Mode().IsRegular()
}
