# CSV Spreadsheet Imports Module

This document outlines the repeated import mapping flows, validations, and security features of the spreadsheet module.

## 1. Google Forms & External Sheets Workflows
Many coordinators capture student registrations using Google Forms, Microsoft Excel sheets, or separate event portals. 

DSMNRU EventHub elevates sheets ingestion to a first-class citizen:
- **Interactive Header Mapping**: Coorindators upload files. The frontend dynamically parses header columns and presents dropdowns to map CSV columns to EventHub's required participant directory.
- **Auto-Mapping Guessing**: The engine automatically detects keys (e.g. matching "student name" or "name" to `full_name`), minimizing manual setup.

## 2. Repeated Sheet Import Logic
Coordinators may import spreadsheets multiple times as registrations continue to roll in.

To prevent duplicate record creations, the server processes imports through a strict matching ledger:
1. **Email Lookup**: The server queries all existing registered emails for the event.
2. **Analysis Breakdown**:
   - **New Rows**: Email is not registered. Creates a new record with a unique sequential ID.
   - **Updated Details**: Email exists, but details like name or college differ. Overwrites the record details while **preserving** the existing `registration_id`.
   - **Ignored Duplicates**: Email and details are identical. Skips insertion to prevent noise.
   - **Rejected Errors**: Rows missing emails or containing malformed email syntaxes.
3. **Interactive Preview**: Before writing to the D1 database, the coordinator reviews detailed statistics and preview samples (first 10 rows) of New, Updated, and Rejected records, requiring explicit action to apply the transaction.

## 3. CSV Injection Safeguards
- **Row limiters**: Max 1,000 lines per sheet prevents Worker timeouts.
- **Cell width limiters**: Max 500 characters prevents memory bloating.
- **Sanitization**: Any cell value starting with spreadsheet execution triggers (`=`, `+`, `-`, `@`) is prepended with a single quote (`'`), neutralizing potential spreadsheet remote code executions (RCE) on coordinators' local computers during future sheet exports.
