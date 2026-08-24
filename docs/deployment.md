# Production Deployment & Checklists

This document details the step-by-step procedure to deploy **DSMNRU EventHub** to production using Cloudflare's free tier.

## Cloudflare Free-Tier Quotas Reference
- **Cloudflare Workers**: 100,000 requests per day (Free).
- **Cloudflare D1 Database**: 5 Million read rows per day, 100,000 write rows per day, 5GB storage (Free).
- **Cloudflare Pages**: Unlimited bandwidth, unlimited static assets, 500 builds per month (Free).
- **Resend Email free tier**: 3,000 emails per month, 100 emails per day (Free).

---

## Deployment Steps

### 1. Database Initialization
Deploy the SQLite schema migrations to your remote Cloudflare D1 instance:
```bash
# Create remote D1 database instance
npx wrangler d1 create dsmnru-eventhub-db

# Apply SQL migrations to production database
npm run db:migrate -- --remote
```
Make sure to copy the `database_id` returned by wrangler and update it under `[[d1_databases]]` inside your production config.

> **Always migrate with `npm run db:migrate`, not a bare `wrangler d1 migrations apply`.**
> `0003_add_password_set.sql` repairs databases that were created before
> `users.password_set` was added to `0001_schema.sql`. Because SQLite/D1 has no
> `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, the runner inspects the live schema
> first and either executes `0003` (legacy databases missing the column) or records
> it as applied without executing it (fresh databases, where `0001` already creates
> the column). It then verifies `users.password_set` exists and fails loudly if not.
> See [Database Schema](database.md#schema-drift-repair-0003) for details.

### 2. Backend Workers Deployment
Deploy your API logic as a global Worker:
```bash
cd backend

# Bind secrets securely in Cloudflare
npx wrangler secret put JWT_SECRET
npx wrangler secret put RESEND_API_KEY

# Deploy to Cloudflare Workers
npx wrangler deploy
```

### 3. Frontend Pages Deployment
Upload the static React + TypeScript bundles to Cloudflare Pages:
```bash
cd frontend

# Build production assets
npm run build

# Deploy assets to Pages
npx wrangler pages deploy dist --project-name dsmnru-eventhub
```
Under Cloudflare Pages dash settings, configure routing proxy to forward `/api/*` requests to your deployed Workers URL.
