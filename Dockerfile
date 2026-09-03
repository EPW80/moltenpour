# MoltenPour ships as one image: the Go binary serving both /api and the built
# SPA on a single origin.
#
# That is not packaging convenience. The owner cookie is the entire access
# control (api/session), and the client fetches "/api/pours" with no base URL,
# so a second origin would mean CORS, SameSite=None and credentialed fetches —
# three ways for a visitor's collection to silently become nobody's.

# ── the app ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html proof.html ./
COPY app/ ./app/
# `npm run build` is `tsc --noEmit && vite build`, so a type error fails the
# image rather than shipping.
RUN npm run build

# ── the server ────────────────────────────────────────────────────────────────
FROM golang:1.25-alpine AS api
WORKDIR /src/api

COPY api/go.mod api/go.sum ./
RUN go mod download

COPY api/ ./
# modernc.org/sqlite is pure Go, so CGO_ENABLED=0 gives a static binary and the
# final stage needs no libc at all.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ── the image ─────────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=api /out/server /usr/local/bin/server
COPY --from=web /src/dist /srv/dist

# The ledger lives on a mounted volume, never in the image layer. A pour's
# serial and ledger position come from this file — losing it re-issues No. 1 to
# somebody, on a document whose whole register is institutional permanence.
VOLUME ["/data"]
EXPOSE 8080

ENV PORT=8080
ENTRYPOINT ["/usr/local/bin/server", "-static", "/srv/dist", "-db", "/data/moltenpour.db"]
