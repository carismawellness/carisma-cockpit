# n8n Setup Guide — macOS (Apple Silicon)

## Quick Start: Local Development

The fastest way to get n8n running locally for workflow development.

### Option 1: npm Global Install (Recommended for Development)

```bash
# Prerequisites: Node.js >= 22.16
node --version  # Check version

# Install n8n globally
npm install -g n8n

# Start n8n
n8n start

# Or start with tunnel for webhook testing from external services
n8n start --tunnel
```

Opens at: **http://localhost:5678**
Data stored in: **~/.n8n/**

The `--tunnel` flag creates a temporary public URL so Meta, Zoho, Wix etc. can send webhooks to your local machine. Only use in development.

### Option 2: npx (Zero Install, Quick Test)

```bash
npx n8n
```

Same as above but doesn't install globally. Always runs the latest version.

### Option 3: Docker (Recommended for Production-Like Environment)

```bash
# Create persistent volume
docker volume create n8n_data

# Run n8n
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -e GENERIC_TIMEZONE="Europe/Malta" \
  -v n8n_data:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n
```

### NOT Available

- **Homebrew:** n8n is NOT in Homebrew. Use npm or Docker.
- **Desktop App:** Archived (Aug 2025), no longer maintained.

## Configuration

### Key Environment Variables

Set these before running `n8n start`, or create `~/.n8n/.env`:

```bash
# Core
export N8N_PORT=5678
export N8N_PROTOCOL=http
export N8N_HOST=localhost
export GENERIC_TIMEZONE="Europe/Malta"

# Encryption (BACK THIS UP — losing it means losing all saved credentials)
export N8N_ENCRYPTION_KEY="your-long-random-string"

# Webhooks (for production — set to your public URL)
export WEBHOOK_URL="https://n8n.yourdomain.com/"

# Logging
export N8N_LOG_LEVEL=info  # debug, info, warn, error

# Execution data retention
export EXECUTIONS_DATA_SAVE_ON_ERROR=all
export EXECUTIONS_DATA_SAVE_ON_SUCCESS=all
export EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true

# Prometheus metrics (optional)
export N8N_METRICS=false
```

### Database Options

**SQLite (Default — Fine for Local Dev)**
```bash
# No configuration needed — uses ~/.n8n/database.sqlite
```

**PostgreSQL (Required for Production)**
```bash
export DB_TYPE=postgresdb
export DB_POSTGRESDB_HOST=localhost
export DB_POSTGRESDB_PORT=5432
export DB_POSTGRESDB_DATABASE=n8n
export DB_POSTGRESDB_USER=n8n
export DB_POSTGRESDB_PASSWORD=your_password
export DB_POSTGRESDB_SCHEMA=public
```

### Data Directory

Everything lives in `~/.n8n/`:
- `database.sqlite` — Workflows, executions, credentials
- `config` — Encryption key (auto-generated on first run)
- `custom/` — Custom node packages

## Production Setup: Docker Compose + PostgreSQL

### docker-compose.yml

```yaml
version: "3.8"

services:
  n8n-postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: n8n
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: n8n
    volumes:
      - postgres_data:/var/lib/postgresql/data

  n8n:
    image: docker.n8n.io/n8nio/n8n
    restart: always
    ports:
      - "5678:5678"
    environment:
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=n8n-postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_USER=n8n
      - DB_POSTGRESDB_PASSWORD=${POSTGRES_PASSWORD}
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
      - WEBHOOK_URL=https://n8n.yourdomain.com/
      - GENERIC_TIMEZONE=Europe/Malta
      - N8N_LOG_LEVEL=warn
      - EXECUTIONS_DATA_SAVE_ON_ERROR=all
      - EXECUTIONS_DATA_SAVE_ON_SUCCESS=none
    volumes:
      - n8n_data:/home/node/.n8n
    depends_on:
      - n8n-postgres

volumes:
  postgres_data:
  n8n_data:
```

### .env file (alongside docker-compose.yml)

```bash
POSTGRES_PASSWORD=a_strong_random_password_here
N8N_ENCRYPTION_KEY=a_long_random_string_BACK_THIS_UP
```

### Commands

```bash
docker compose up -d                    # Start
docker compose logs -f n8n              # View logs
docker compose pull && docker compose down && docker compose up -d  # Update
docker compose down                     # Stop
```

## Reverse Proxy (Nginx + SSL)

```nginx
server {
    listen 443 ssl http2;
    server_name n8n.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/n8n.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/n8n.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:5678;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        chunked_transfer_encoding off;
        proxy_buffering off;
        proxy_cache off;
    }
}
```

WebSocket headers (`Upgrade`, `Connection`) are essential — n8n uses WebSockets for the editor.

## Building from Source (Custom Node Development)

```bash
git clone https://github.com/n8n-io/n8n.git
cd n8n

# Requires: Node.js >= 24, pnpm >= 10.22
corepack enable
# macOS Homebrew users:
brew install corepack
corepack prepare pnpm@10.22.0 --activate

pnpm install
pnpm build
pnpm start

# Dev with hot-reload:
pnpm dev      # Full stack
pnpm dev:be   # Backend only
pnpm dev:fe   # Frontend only
```

## Licensing

### Community Edition (Free) — What We Use
- All 400+ integrations
- Unlimited workflows and executions
- AI/LangChain nodes, webhooks, cron triggers
- Full REST API
- You manage: hosting, backups, updates

### Enterprise Features (Paid)
- SSO (SAML, LDAP)
- Role-based access control
- Git version control for workflows
- Multiple environments (dev/staging/prod)
- Audit logging

### Cloud Plans
- Starter: EUR 20/mo (2,500 executions)
- Pro: EUR 50/mo (custom executions)
- Enterprise: Custom pricing
- 50% startup discount available (<20 employees)

**Bottom line:** Free Community Edition is fully sufficient for Carisma's internal automation needs.

## First Steps After Installation

1. Open http://localhost:5678
2. Create your admin account
3. Go to Settings → API → Generate API key (save it for n8n-mcp)
4. Go to Settings → Community nodes → Install `@wix/n8n-nodes-wix` for Wix integration
5. Set up credentials for: Zoho CRM (×3), Meta Ads, Google Sheets, Klaviyo, WhatsApp
6. Import your first workflow from `Tech/CEO-Cockpit/n8n/workflows/`

## Update n8n

```bash
# npm
npm update -g n8n

# Docker
docker pull docker.n8n.io/n8nio/n8n
docker compose down && docker compose up -d

# Check version
n8n --version
```

Current latest: **2.16.1** (as of Apr 2026)
