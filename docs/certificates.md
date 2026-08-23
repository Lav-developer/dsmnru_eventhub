# Browser-Side Heavy Certificates Engine

This document details the design of the high-fidelity bulk certificate generator module.

## 1. Zero-Cost Architectural Directive
**Rule**: No generated certificate PDFs can ever be uploaded, hosted, or stored on Cloudflare Worker, D1, R2, or disk databases.

Hosting PDFs for hundreds of students during academic events leads to:
- High storage usage (exceeding D1/R2 free caps).
- High egress network costs.
- High Worker CPU execution overhead during compilation.

**Solution**: 100% browser-side generation. The server acts as a digital authority ledger, registering unique ID claims, while the participant's browser compiles, designs, and packages the PDF ZIP out-of-band.

## 2. Compilation Flow Diagram
```
Coordinator: Uploads Template Coordinates & logo
                     |
Coordinator: Clicks "Generate ZIP"
                     |
Vite App: Fetches attendees list from D1
                     |
Vite App: Registers Issued Metadata in D1 (generates unique IDs)
                     |
Vite App: Sequentially compiles landscape layout via `jsPDF`
                     |
Vite App: Packages PDFs into `JSZip`
                     |
Vite App: Triggers immediate direct download
```

## 3. High-Fidelity Landscape Layout Specifications
- **Dimensions**: Standard A4 Landscape (~297mm x 210mm).
- **Structure**:
  - Double inner borders with royal blue primary branding.
  - Centered University Header & Established Sub-heading.
  - Dynamically scaled student names supporting spaces, hyphens, and Indic/Unicode text.
  - Split text description margins wrapping perfectly without canvas overflow.
  - Unique validation footer printing the cryptographic Registry ID and validation page URL.
  - QR alignment box containing verification guidelines.

## 4. Unicode & Accented Names Support
The PDF engine utilizes standard Helvetica/Unicode characters out-of-the-box. Custom coordinates prevent letter spacing truncation when handling Hindi, Indic, or special character names.
