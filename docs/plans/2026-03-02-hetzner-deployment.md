# Hetzner Company Backend Deployment Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy Comp AI to Hetzner VPS at 46.225.221.111 with Caddy reverse proxy, VPS Postgres, GitHub Actions CI/CD, and a static hub dashboard.

**Architecture:** Caddy terminates SSL for 4 subdomains (company, compliance, portal, crm). Comp app + portal run as Docker containers built in GitHub Actions and pushed to GHCR. A separate Postgres 16 container serves Comp. Twenty CRM stays in its own compose stack but joins a shared Caddy network.

**Tech Stack:** Docker Compose, Caddy 2, PostgreSQL 16, GitHub Actions, GHCR, SSH deploy

---

### Task 1: Create Caddyfile

**Files:**
- Create: `Caddyfile`

**Step 1: Create the Caddyfile**

```caddy
company.ultrarelevant.com {
	root * /srv/hub
	file_server
}

compliance.ultrarelevant.com {
	reverse_proxy comp-app:3000
}

portal.ultrarelevant.com {
	reverse_proxy comp-portal:3000
}

crm.ultrarelevant.com {
	reverse_proxy twenty-server-1:3000
}
```

**Step 2: Commit**

```bash
git add Caddyfile
git commit -m "feat(infra): add Caddyfile for Hetzner deployment"
```

---

### Task 2: Create production Docker Compose

**Files:**
- Create: `docker-compose.prod.yml`

**Step 1: Create docker-compose.prod.yml**

This compose file defines: comp-db (Postgres), comp-app, comp-portal, and caddy. All services join a `caddy-net` network. Twenty CRM connects to caddy-net via an external network reference.

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: '10m'
    max-file: '5'
    compress: 'true'

networks:
  caddy-net:
    name: caddy-net
    driver: bridge
  comp-internal:
    driver: bridge

volumes:
  caddy_data:
  caddy_config:
  comp_db_data:

services:
  comp-db:
    image: postgres:16
    volumes:
      - comp_db_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: comp
      POSTGRES_USER: comp
      POSTGRES_PASSWORD: ${COMP_DB_PASSWORD}
    healthcheck:
      test: pg_isready -U comp -h localhost -d comp
      interval: 5s
      timeout: 5s
      retries: 10
    restart: always
    networks:
      - comp-internal
    logging: *default-logging

  comp-app:
    image: ghcr.io/couragefalco/comp/app:latest
    env_file:
      - .env.app
    depends_on:
      comp-db:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ['CMD-SHELL', 'curl -f http://localhost:3000/api/health || exit 1']
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - caddy-net
      - comp-internal
    logging: *default-logging

  comp-portal:
    image: ghcr.io/couragefalco/comp/portal:latest
    env_file:
      - .env.portal
    depends_on:
      comp-db:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ['CMD-SHELL', 'curl -f http://localhost:3000/ || exit 1']
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - caddy-net
      - comp-internal
    logging: *default-logging

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ./hub:/srv/hub
      - caddy_data:/data
      - caddy_config:/config
    restart: unless-stopped
    networks:
      - caddy-net
    logging: *default-logging
```

**Step 2: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat(infra): add production docker-compose for Hetzner"
```

---

### Task 3: Create static hub dashboard

**Files:**
- Create: `hub/index.html`

**Step 1: Create hub/index.html**

A clean, minimal dashboard with cards linking to compliance, portal, and CRM. Dark theme, responsive, no external dependencies.

**Step 2: Commit**

```bash
git add hub/
git commit -m "feat(infra): add static hub dashboard for company.ultrarelevant.com"
```

---

### Task 4: Create GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy-hetzner.yml`

**Step 1: Create the workflow**

Triggers on push to main. Jobs:

1. **build** — runs on `ubuntu-latest`:
   - Checkout code
   - Login to GHCR
   - Build `app` and `portal` Docker targets with build args:
     - `NEXT_PUBLIC_BETTER_AUTH_URL=https://compliance.ultrarelevant.com`
     - `NEXT_PUBLIC_PORTAL_URL=https://portal.ultrarelevant.com`
   - Push to `ghcr.io/couragefalco/comp/app:latest` and `ghcr.io/couragefalco/comp/portal:latest`

2. **migrate** — needs build:
   - Build migrator target
   - Run migrations against production DATABASE_URL

3. **deploy** — needs build, migrate:
   - SSH into 46.225.221.111
   - cd /opt/comp
   - docker compose -f docker-compose.prod.yml pull
   - docker compose -f docker-compose.prod.yml up -d comp-app comp-portal caddy

**Required GitHub Secrets:**
- `GHCR_TOKEN` — GitHub PAT with `write:packages` scope (or use `GITHUB_TOKEN`)
- `VPS_SSH_KEY` — private SSH key for root@46.225.221.111
- `VPS_HOST` — `46.225.221.111`
- `VPS_USER` — `root`
- `COMP_DB_PASSWORD` — Postgres password for comp database
- `PROD_DATABASE_URL` — `postgresql://comp:PASSWORD@comp-db:5432/comp`

**Step 2: Commit**

```bash
git add .github/workflows/deploy-hetzner.yml
git commit -m "feat(ci): add GitHub Actions workflow for Hetzner deployment"
```

---

### Task 5: Server setup — shared Docker network and directory structure

**Step 1: SSH into server and create directory structure**

```bash
ssh root@46.225.221.111
mkdir -p /opt/comp
```

**Step 2: Create shared caddy-net network**

```bash
docker network create caddy-net
```

**Step 3: Connect Twenty to caddy-net**

Modify Twenty's docker-compose to join caddy-net as an external network:

In `/opt/twenty/docker-compose.yml`, add to the `server` service:
```yaml
networks:
  - default
  - caddy-net
```

And at the top level:
```yaml
networks:
  caddy-net:
    external: true
```

**Step 4: Restart Twenty with new network**

```bash
cd /opt/twenty
docker compose down
docker compose up -d
```

**Step 5: Remove Twenty's port 3000 exposure**

Remove `ports: - "3000:3000"` from Twenty's server service since Caddy will proxy instead.

---

### Task 6: Server setup — env files and first deploy

**Step 1: Create .env.app on the server**

Copy from existing local `apps/app/.env` but change:
- `DATABASE_URL` → `postgresql://comp:PASSWORD@comp-db:5432/comp`
- `BETTER_AUTH_URL` → `https://compliance.ultrarelevant.com`
- `NEXT_PUBLIC_BETTER_AUTH_URL` → `https://compliance.ultrarelevant.com`
- `NEXT_PUBLIC_PORTAL_URL` → `https://portal.ultrarelevant.com`
- `NEXT_PUBLIC_SELF_HOSTED` → `true`

**Step 2: Create .env.portal on the server**

Copy from existing local `apps/portal/.env` but change:
- `DATABASE_URL` → `postgresql://comp:PASSWORD@comp-db:5432/comp`
- `BETTER_AUTH_URL` → `https://portal.ultrarelevant.com`
- `NEXT_PUBLIC_BETTER_AUTH_URL` → `https://portal.ultrarelevant.com`

**Step 3: Create .env on the server for docker-compose**

```bash
echo 'COMP_DB_PASSWORD=<generated-password>' > /opt/comp/.env
```

**Step 4: SCP Caddyfile and hub to server**

```bash
scp Caddyfile root@46.225.221.111:/opt/comp/
scp -r hub root@46.225.221.111:/opt/comp/
scp docker-compose.prod.yml root@46.225.221.111:/opt/comp/
```

---

### Task 7: DNS records

**Step 1: Add A and AAAA records**

In the ultrarelevant.com DNS provider, add:

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

**Step 2: Verify DNS propagation**

```bash
dig company.ultrarelevant.com +short
dig compliance.ultrarelevant.com +short
dig portal.ultrarelevant.com +short
dig crm.ultrarelevant.com +short
```

All should return `46.225.221.111`.

---

### Task 8: First deploy — start everything

**Step 1: Start comp-db first**

```bash
cd /opt/comp
docker compose -f docker-compose.prod.yml up -d comp-db
```

**Step 2: Run migrator**

Build and run the migrator from the repo (or from a pushed image). This creates the database schema:

```bash
docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL=postgresql://comp:PASSWORD@comp-db:5432/comp \
  --entrypoint "bunx prisma migrate deploy --schema=node_modules/@trycompai/db/dist/schema.prisma" \
  comp-app
```

Alternatively, build the migrator image in CI and run it.

**Step 3: Start all services**

```bash
docker compose -f docker-compose.prod.yml up -d
```

**Step 4: Verify**

```bash
curl -f https://compliance.ultrarelevant.com/api/health
curl -f https://portal.ultrarelevant.com
curl -f https://crm.ultrarelevant.com/healthz
curl -f https://company.ultrarelevant.com
```

---

### Task 9: Firewall hardening

**Step 1: Enable Hetzner Cloud Firewall**

In Hetzner Cloud Console, create firewall allowing only:
- TCP 22 (SSH)
- TCP 80 (HTTP)
- TCP 443 (HTTPS)

**Step 2: Enable ufw on server**

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Note: Docker bypasses ufw. Since no containers publish ports except Caddy (80/443), this is safe. The comp-app, comp-portal, and Twenty containers have no published ports.
