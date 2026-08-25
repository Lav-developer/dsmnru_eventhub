# DSMNRU EventHub

**DSMNRU EventHub** is a production-grade, zero-cost, serverless event management platform designed for the academic departments of Dr. Shakuntala Misra National Rehabilitation University (DSMNRU), Lucknow.

It manages the entire academic event lifecycle: **Create &rarr; Register &rarr; Communicate &rarr; Conduct &rarr; Distribute &rarr; Certify &rarr; Verify**.

---

## 🚀 Guiding Engineering Principle
> **Thin frontend requests + strict Worker validation + constrained D1 queries + browser-side heavy certificate work + minimal persistent file storage.**

By offloading heavy PDF rendering, ZIP packaging, and QR decoding entirely to the client's web browser, we minimize server CPU cycles, storage needs, and network bandwidth. This ensures the entire system runs flawlessly within Cloudflare's ₹0 free tier, sustaining high-traffic academic events with **zero recurring infrastructure costs**.

---

## 🏛️ Project Directory Structure
```
dsmnru_eventhub/
├── backend/            # Cloudflare Workers API utilizing Hono Framework
│   ├── src/            # Hono server routers, crypto helpers, and mailers
│   ├── migrations/     # D1 SQLite relational database schemas
│   └── tsconfig.json   # TypeScript configurations
├── frontend/           # Vite + React + Tailwind CSS dashboard portal
│   ├── src/            # React pages, modular components, and views
│   └── tailwind.config # Tailwind branding presets
├── docs/               # Technical specifications & documentation
│   ├── architecture.md # Topology & serverless framework
│   ├── database.md     # Relational SQLite tables & index scopes
│   ├── security.md     # OWASP safeguards & encryption
│   ├── email.md        # Asynchronous mail queue processors
│   ├── certificates.md # Client-side bulk pdf builders
│   ├── qr-system.md    # Opaque token camera scans
│   ├── csv-import.md   # Auto-header mapping & duplicate logic
│   └── operations.md   # Gates check-in & food claims locks
└── README.md           # Getting started guidelines
```

---

## 🛠️ Getting Started Locally

### Prerequisites
- Node.js v20 or later
- npm v10 or later

### 1. Database & Backend Setup
Navigate to the `backend/` directory, install packages, and apply SQL schema migrations to your local SQLite database:
```bash
cd backend

# Install node dependencies
npm install

# Run database schema migrations locally
npm run db:migrate

# Generate TypeScript types from wrangler environment
npm run cf-typegen
```

Start the backend API server using Wrangler's local dev server:
```bash
# Start Wrangler API on http://127.0.0.1:8787
npm run dev
```

### 2. Frontend Setup
Open a separate terminal, navigate to the `frontend/` directory, install packages, and boot up Vite's hot-reloaded local dev server:
```bash
cd frontend

# Install react packages
npm install

# Start Vite hot-reload on http://localhost:5173
npm run dev
```
Vite is pre-configured with a proxy. Any relative requests directed to `/api/*` are automatically forwarded to Wrangler's port `8787`.

---

## 🔒 Security Assertions
- **Password Security**: Natively hashed using PBKDF2 with SHA-256 (100,000 iterations) with salt.
- **Privacy Protections**: QR codes encode an opaque secure UUID token only. Absolute zero PII (names, emails, phones) is embedded inside the barcodes.
- **Race Condition Protections**: Database unique indices on `attendance` and `resource_claims` prevent double claims or gate replay attacks under simultaneous multi-counter scans.
- **Formula Injection Defense**: Parser sanitizes spreadsheet cells beginning with `=`, `+`, `-`, `@` with a single quote (`'`) to neutralize Excel RCE exploits.

---

## 📄 Technical Specifications & Architecture Docs
For in-depth explanations of the codebases, check out the markdown files inside the `docs/` folder:
- 🏛️ [Core Architecture & Topology](docs/architecture.md)
- 💾 [D1 Database Schema & Indexing](docs/database.md)
- 🛡️ [OWASP Safeguards & Security](docs/security.md)
- 📥 [CSV Sheets Auto-Mapping & Import Logic](docs/csv-import.md)
- 🎫 [Opaque Token QR Passes View](docs/qr-system.md)
- 🚪 [Gate Attendance & Kit Claims Controls](docs/operations.md)
- 📜 [Client-Side Heavy PDF ZIP Generator](docs/certificates.md)
- 📬 [Asynchronous Mail Queue Processors](docs/email.md)
- 🚀 [Cloudflare Production Deployment Guide](docs/deployment.md)
