# Lightweight QR Scanning Module

This document outlines the architecture, scanner logic, and security features of the event pass QR scanning system.

## 1. Minimalist Architectural Principle
The scanning module is designed to work out-of-the-box on standard mobile browser cameras without requiring:
- Separate WebSocket servers.
- Dedicated mobile native applications.
- Server-side image uploads or processing.

## 2. Security: No PII inside QR Codes
Placing names, phone numbers, or emails inside a QR barcode exposes participants to privacy hijackings during campus entry checks.

**EventHub Design**:
- The QR pass contains a **cryptographically secure opaque UUID registration token** (the primary key `id` of `event_registrations`).
- It contains absolute zero Personally Identifiable Information (PII).
- The volunteer's browser decodes this token locally and sends it via an HTTPS POST payload to the Hono Worker.
- The server performs authority mappings and returns name/college values strictly to validated volunteers, maintaining maximum privacy.

## 3. Real-Time Camera Scanner UI
The scanner UI runs at 15 FPS using `html5-qrcode` library, presenting a lightweight and responsive mobile-first gate control:
- **Continuous Scan**: The camera remains active continuously. There are no page reloads or screen redirects on scan successes, enabling high-throughput entry.
- **Opaque Token fallback**: A manual textbox is positioned below the viewfinder, enabling volunteers to type in passes manually if camera lenses are scratched or dirty.
- **Color-Coded Verification Screens**:
  - **GREEN**: Success! Attendance recorded or resource successfully claimed.
  - **YELLOW**: Warning. Token is valid but has already been checked in or claimed.
  - **RED**: Error/Invalid. Pass is forged or belongs to a different event.
