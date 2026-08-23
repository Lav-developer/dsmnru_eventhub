# Security Specifications

This document outlines the security architecture and protections built into **DSMNRU EventHub**.

## 1. Authentication & Session Management
- **Cryptographic Hashing**: Passwords are never stored in plaintext. Hashing utilizes **PBKDF2 with SHA-256** and a unique random salt per user (100,000 iterations), executed natively via the Cloudflare Workers Web Crypto API.
- **Session Tokens**: Authenticated sessions are issued opaque cryptographically secure 32-byte tokens (`sessions` table).
- **Security Cookies**: Cookies are set with the `HttpOnly`, `SameSite=Lax`, and `Secure` (production only) flags, preventing XSS-based session hijacking.

## 2. Server-Side Role-Based Access Control (RBAC)
Strict authority checks are enforced on every route:
- **Super Admin**: Complete platform visibility, department controls, coordinator account approvals/suspensions, and observability panels.
- **Department Head**: Controls their specific department and events. Cannot access private lists of external departments.
- **Coordinator**: Manages assigned events only (agenda, speakers, CSV sheet imports, certificates issuing, and emails campaign queue).
- **Volunteer**: Limited scanner access only. Cannot update configurations or delete participants.
- **Participant**: Public listings, registration form submission, certificate verification.

## 3. QR Opaque Pass Security
- **No PII inside QR**: Unlike primitive systems that serialize names/emails/phones into the QR barcode, our QR passes encode an **opaque registration UUID token only**. 
- **Server Verification**: The camera scanner decodes the token and sends it via HTTPS to the Worker API. The server maps this token against the SQLite database to fetch details and record logs.
- **Replay & Concurrency Protections**: Database unique keys (e.g. `UNIQUE(event_id, registration_id, attendance_type)`) ensure attendance or resources claims can never be double-checked or hijacked under rapid simultaneous counter scans.

## 4. CSV & Spreadsheet Formula Injection (OWASP mitigation)
- **Oversized payloads protection**: The CSV parser restricts lines count to a maximum of 1,000 rows, columns to 50, and cells to 500 characters, safeguarding Worker threads from memory exhaustion.
- **Spreadsheet Protection**: Any imported or exported cells starting with dangerous spreadsheet operators (`=`, `+`, `-`, `@`) are sanitized by prepending a single quote (`'`), neutralizing potential Excel/Sheet remote code executions (RCE) on coordinators' personal devices.
- **No Execution**: Uploaded spreadsheet content is parsed purely as text metadata, never executed or evaluated.

## 5. Email Bombing Prevention
- **Campaign safeguards**: Users must confirm estimated recipient counts before launching emails.
- **Strict rate-limiting**: Strict limiters restrict email campaigns creation to prevent spamming.
- **Asynchronous processing**: Email queuing with exponential backoff retry logs prevents provider free-tier quota burns.
