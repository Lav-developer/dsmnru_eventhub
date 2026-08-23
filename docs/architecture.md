# DSMNRU EventHub Architecture

## Core Architectural Philosophy
DSMNRU EventHub is designed to follow a **zero-cost, highly scalable serverless architecture** utilizing Cloudflare Workers, Cloudflare D1, and Cloudflare Pages.

The guiding architectural principle is:
> **Thin frontend requests + strict Worker validation + constrained D1 queries + browser-side heavy certificate work + minimal persistent file storage.**

By offloading computationally intensive tasks (such as QR scanning, certificate rendering, PDF generation, and ZIP compression) to the user's browser, we minimize server CPU cycles, memory usage, and storage requirements. This ensures the entire system can run reliably within the Cloudflare free tier, sustaining high-traffic academic events with zero recurring infrastructure costs.

## System Topology
```
                  [ Web Browser (User Interface) ]
                 /                |               \
   (Static Assets)          (API Requests)      (Direct Download)
               /                  |                 \
     [ Cloudflare Pages ]   [ Cloudflare Workers ]   [ Browser-Side PDF/ZIP ]
                                  |
                            [ Cloudflare D1 ] (SQL Database)
```

## Tech Stack
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router, Lucide Icons.
- **Backend API**: Cloudflare Workers, Hono Framework (for routing, validation, and middleware).
- **Database**: Cloudflare D1 (Serverless SQL Database based on SQLite).
- **Authentication**: JWT-based session management stored in Secure, HttpOnly cookies with CSRF protection, backed by Argon2/bcrypt password hashing on the Worker.
- **Email Delivery**: Provider abstraction interface supporting Resend and Brevo free tiers.
- **Certificate Engine**: Client-side generation using `jspdf` / `html2canvas` and client-side ZIP packaging using `jszip`.
- **QR Decoding & System**: Browser-side HTML5 QR scanner (`html5-qrcode`) decoding cryptographically unpredictable opaque tokens.
