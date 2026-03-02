# Hetzner Company Backend Deployment

**Date:** 2026-03-02
**Server:** 46.225.221.111 (2a01:4f8:c0c:3274::/64)
**Status:** Approved

## Domain Routing

| Domain | Service | Container |
|--------|---------|-----------|
| `company.ultrarelevant.com` | Static hub dashboard | Caddy (static files) |
| `compliance.ultrarelevant.com` | Comp AI (main compliance platform) | comp-app |
| `portal.ultrarelevant.com` | Comp portal | comp-portal |
| `crm.ultrarelevant.com` | Twenty CRM (existing) | twenty-server-1 |

All domains terminate SSL at Caddy (automatic Let's Encrypt).

## Architecture

```
Internet → Caddy (:80/:443)
              ├─ company.*     → /srv/hub/index.html (static)
              ├─ compliance.*  → comp-app:3000 (internal Docker network)
              ├─ portal.*     → comp-portal:3000 (internal Docker network)
              └─ crm.*        → twenty-server-1:3000 (internal Docker network)
```

No container ports are publicly exposed except Caddy's 80/443.

## Infrastructure

- **Reverse proxy + SSL:** Caddy 2 (auto Let's Encrypt)
- **Comp database:** Separate Postgres 16 container (isolated from Twenty's Postgres)
- **CI/CD:** GitHub Actions — build on push to main, push to GHCR, SSH deploy
- **Registry:** ghcr.io/couragefalco/comp

## Files to Create

1. `docker-compose.prod.yml` — production compose (comp-app, comp-portal, comp-db, caddy)
2. `Caddyfile` — domain routing for all 4 subdomains
3. `.github/workflows/deploy-hetzner.yml` — CI/CD pipeline
4. `hub/index.html` — static dashboard linking to all services

## DNS Records

```
A     company.ultrarelevant.com      → 46.225.221.111
A     compliance.ultrarelevant.com   → 46.225.221.111
A     portal.ultrarelevant.com       → 46.225.221.111
A     crm.ultrarelevant.com          → 46.225.221.111
AAAA  company.ultrarelevant.com      → 2a01:4f8:c0c:3274::1
AAAA  compliance.ultrarelevant.com   → 2a01:4f8:c0c:3274::1
AAAA  portal.ultrarelevant.com       → 2a01:4f8:c0c:3274::1
AAAA  crm.ultrarelevant.com          → 2a01:4f8:c0c:3274::1
```

## Server State

- Ubuntu 24.04, Docker 29.2.1, Docker Compose v5.1.0
- 2 vCPUs, 3.7GB RAM, 75GB disk (67GB free)
- Twenty CRM already running (postgres:16, redis, server, worker)
- UFW inactive

## Key Decisions

- **Separate Postgres** for Comp (isolation from Twenty)
- **Build in GitHub Actions** (server has insufficient RAM for Next.js builds)
- **Self-hosted mode** (`NEXT_PUBLIC_SELF_HOSTED=true`) — no Stripe needed
- **Push to main triggers deploy** — matches existing workflow patterns
- **Static hub dashboard** — simple HTML/CSS cards linking to services, served by Caddy
