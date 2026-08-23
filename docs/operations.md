# Campus Operations Module

This document outlines the campus operations module, managing gate entry check-ins and kit/lunch resources claims.

## 1. Multi-Scanner Gate Isolation
During large conventions, departments position volunteers across multiple entrance gates (e.g. Gate 1, Gate 2, Gate 3) scanning participants simultaneously.

**Race Condition Prevention**:
A participant may print their QR pass multiple times and attempt to claim multiple kits or enter different gates simultaneously.
- **D1 Uniqueness**: The `attendance` and `resource_claims` tables are guarded by unique composite indices:
  - `UNIQUE(event_id, registration_id, attendance_type)`
  - `UNIQUE(event_id, registration_id, resource_id)`
- **Atomic Inserts**: The server performs direct atomic inserts. Under concurrent simultaneous scans, SQLite's transactional engine allows the first insert to succeed while throwing a unique constraint violation error on subsequent attempts.
- **Friendly Exceptions**: The server catches SQLite violations and returns a friendly `ALREADY_CLAIMED` (Yellow) error back to the volunteer's browser, preventing duplicate entries.

## 2. Dynamic Resources & Food Management
Coordinators configure custom counters (e.g. "Lunch Token", "Registration Kit") directly from the dashboard:
- **Quantity Limits**: Set overall capacity bounds (e.g. 500 kits).
- **Eligibility Checking**: Restrict claims based on attendance. If eligibility is set to `attendees`, the server rejects claims unless the participant has already scanned in at the gate, preventing non-attending registrations from draining inventory.
- **State-Free Metrics**: Remaining quantities are calculated on the fly:
  `Remaining = Total Quantity - (SELECT COUNT(*) FROM resource_claims WHERE resource_id = r.id)`
  This ensures real-time accuracy without lock overheads or complex synchronization models.
