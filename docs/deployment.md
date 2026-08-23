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
npx wrangler d1 migrations apply dsmnru-eventhub-db --remote
```
Make sure to copy the `database_id` returned by wrangler and update it under `[[d1_databases]]` inside your production config.

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
