# Database Schema Design

This document details the database schema for DSMNRU EventHub. The database runs on **Cloudflare D1** (SQLite compatible).

## Tables Schema

### 1. `users`
Represents users (Super Admins, Department Heads, Coordinators, Volunteers).
- `id` TEXT PRIMARY KEY (UUID)
- `email` TEXT UNIQUE NOT NULL
- `password_hash` TEXT NOT NULL
- `full_name` TEXT NOT NULL
- `phone` TEXT
- `role` TEXT NOT NULL (e.g. 'super_admin', 'department_head', 'coordinator', 'volunteer')
- `status` TEXT NOT NULL DEFAULT 'invited' (pending, invited, active, suspended)
- `password_set` INTEGER NOT NULL DEFAULT 0 (0 until the invitee completes `/auth/setup-password`)
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### 2. `departments`
Academic departments in DSMNRU.
- `id` TEXT PRIMARY KEY (UUID)
- `name` TEXT UNIQUE NOT NULL
- `code` TEXT UNIQUE NOT NULL (e.g., 'CS', 'EE', 'MBA')
- `description` TEXT
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### 3. `department_members`
Links users to departments (for Department Heads and Coordinators).
- `department_id` TEXT REFERENCES departments(id)
- `user_id` TEXT REFERENCES users(id)
- PRIMARY KEY (department_id, user_id)

### 4. `events`
Events hosted on the platform.
- `id` TEXT PRIMARY KEY (UUID)
- `slug` TEXT UNIQUE NOT NULL
- `name` TEXT NOT NULL
- `short_name` TEXT NOT NULL
- `event_type` TEXT NOT NULL (conference, seminar, workshop, etc.)
- `department_id` TEXT REFERENCES departments(id)
- `theme` TEXT
- `description` TEXT
- `banner_url` TEXT
- `start_date` TEXT NOT NULL (YYYY-MM-DD)
- `end_date` TEXT NOT NULL (YYYY-MM-DD)
- `start_time` TEXT NOT NULL (HH:MM)
- `end_time` TEXT NOT NULL (HH:MM)
- `venue` TEXT NOT NULL
- `format` TEXT NOT NULL (online, offline, hybrid)
- `meeting_link` TEXT
- `registration_type` TEXT NOT NULL (built_in, external)
- `external_form_url` TEXT
- `status` TEXT NOT NULL DEFAULT 'DRAFT' (DRAFT, PUBLISHED, REGISTRATION_OPEN, REGISTRATION_CLOSED, ONGOING, COMPLETED, ARCHIVED)
- `google_drive_folder_url` TEXT
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### 5. `event_members`
Coordinators and Volunteers assigned to specific events.
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `user_id` TEXT REFERENCES users(id) ON DELETE CASCADE
- `role` TEXT NOT NULL (coordinator, volunteer)
- PRIMARY KEY (event_id, user_id)

### 6. `registration_fields`
Custom fields defined for built-in event registration.
- `id` TEXT PRIMARY KEY (UUID)
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `label` TEXT NOT NULL
- `description` TEXT
- `field_type` TEXT NOT NULL (text, textarea, number, dropdown, radio, checkbox, date)
- `required` INTEGER DEFAULT 0 (0 or 1)
- `options` TEXT (JSON array of options)
- `field_order` INTEGER DEFAULT 0
- UNIQUE(event_id, label)

### 7. `event_registrations`
Participants registered for an event.
- `id` TEXT PRIMARY KEY (UUID) (Opaque cryptographically secure ID)
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `registration_id` TEXT NOT NULL (e.g. DSMNRU-EVENT-000001)
- `full_name` TEXT NOT NULL
- `email` TEXT NOT NULL
- `phone` TEXT NOT NULL
- `college` TEXT NOT NULL
- `department` TEXT NOT NULL
- `course` TEXT NOT NULL
- `year` TEXT NOT NULL
- `designation` TEXT NOT NULL
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- UNIQUE(event_id, email)
- UNIQUE(event_id, registration_id)

### 8. `registration_responses`
Answers to custom registration fields.
- `id` TEXT PRIMARY KEY (UUID)
- `registration_id` TEXT REFERENCES event_registrations(id) ON DELETE CASCADE
- `field_id` TEXT REFERENCES registration_fields(id) ON DELETE CASCADE
- `value` TEXT NOT NULL
- UNIQUE(registration_id, field_id)

### 9. `registration_imports`
History of CSV registration imports.
- `id` TEXT PRIMARY KEY (UUID)
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `uploader_id` TEXT REFERENCES users(id)
- `filename` TEXT NOT NULL
- `row_count` INTEGER NOT NULL
- `inserted_count` INTEGER NOT NULL
- `updated_count` INTEGER NOT NULL
- `duplicate_count` INTEGER NOT NULL
- `rejected_count` INTEGER NOT NULL
- `timestamp` DATETIME DEFAULT CURRENT_TIMESTAMP

### 10. `registration_import_errors`
Detailed error logs for failed CSV rows.
- `id` TEXT PRIMARY KEY (UUID)
- `import_id` TEXT REFERENCES registration_imports(id) ON DELETE CASCADE
- `row_number` INTEGER NOT NULL
- `raw_data` TEXT NOT NULL (JSON string of row)
- `error_reason` TEXT NOT NULL

### 11. `speakers`
Speaker master records.
- `id` TEXT PRIMARY KEY (UUID)
- `name` TEXT NOT NULL
- `designation` TEXT NOT NULL
- `institution` TEXT NOT NULL
- `photo_url` TEXT
- `biography` TEXT
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### 12. `event_speakers`
Speakers assigned to events.
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `speaker_id` TEXT REFERENCES speakers(id) ON DELETE CASCADE
- PRIMARY KEY (event_id, speaker_id)

### 13. `schedule_items`
Schedule items for an event.
- `id` TEXT PRIMARY KEY (UUID)
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `start_time` TEXT NOT NULL (HH:MM or YYYY-MM-DD HH:MM)
- `end_time` TEXT NOT NULL
- `title` TEXT NOT NULL
- `description` TEXT
- `speaker_name` TEXT
- `location` TEXT

### 14. `announcements`
Announcements published for an event.
- `id` TEXT PRIMARY KEY (UUID)
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `title` TEXT NOT NULL
- `content` TEXT NOT NULL
- `priority` TEXT NOT NULL DEFAULT 'normal' (low, normal, high)
- `published_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### 15. `attendance`
Records of attendance at events.
- `id` TEXT PRIMARY KEY (UUID)
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `registration_id` TEXT REFERENCES event_registrations(id) ON DELETE CASCADE
- `scanner_id` TEXT REFERENCES users(id)
- `attendance_type` TEXT NOT NULL DEFAULT 'event_entry'
- `timestamp` DATETIME DEFAULT CURRENT_TIMESTAMP
- UNIQUE(event_id, registration_id, attendance_type)

### 16. `resources`
Resource definitions (e.g. Lunch, Goodie Bag).
- `id` TEXT PRIMARY KEY (UUID)
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `name` TEXT NOT NULL
- `quantity` INTEGER NOT NULL
- `eligibility` TEXT NOT NULL DEFAULT 'all' (all, attendees)
- `claim_limit` INTEGER NOT NULL DEFAULT 1
- `status` TEXT NOT NULL DEFAULT 'active' (active, inactive)
- UNIQUE(event_id, name)

### 17. `resource_claims`
Records of resource claims.
- `id` TEXT PRIMARY KEY (UUID)
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `registration_id` TEXT REFERENCES event_registrations(id) ON DELETE CASCADE
- `resource_id` TEXT REFERENCES resources(id) ON DELETE CASCADE
- `scanner_id` TEXT REFERENCES users(id)
- `timestamp` DATETIME DEFAULT CURRENT_TIMESTAMP
- UNIQUE(event_id, registration_id, resource_id)

### 18. `certificate_templates`
Global certificate templates created by Super Admin.
- `id` TEXT PRIMARY KEY (UUID)
- `name` TEXT UNIQUE NOT NULL
- `bg_image_url` TEXT
- `layout_json` TEXT NOT NULL (Fonts, sizes, positions, text content)
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### 19. `event_certificate_templates`
Copies of global templates customized for events.
- `id` TEXT PRIMARY KEY (UUID)
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `name` TEXT NOT NULL
- `bg_image_url` TEXT
- `layout_json` TEXT NOT NULL
- `certificate_type` TEXT NOT NULL (Participation, Appreciation, Speaker, Volunteer, Organizer, Winner, Runner-up, Custom)
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- UNIQUE(event_id, certificate_type)

### 20. `certificate_records`
Issued certificates' metadata.
- `id` TEXT PRIMARY KEY (UUID) (e.g. DSMNRU-2026-A8F42K91 - Opaque cryptographic/random code)
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `registration_id` TEXT REFERENCES event_registrations(id) ON DELETE CASCADE
- `participant_name` TEXT NOT NULL
- `certificate_type` TEXT NOT NULL
- `issued_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### 21. `email_templates`
Templates for emails.
- `id` TEXT PRIMARY KEY (UUID)
- `name` TEXT UNIQUE NOT NULL
- `subject` TEXT NOT NULL
- `body_html` TEXT NOT NULL
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### 22. `email_campaigns`
Email campaigns sent or queued.
- `id` TEXT PRIMARY KEY (UUID)
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `sender_id` TEXT REFERENCES users(id)
- `title` TEXT NOT NULL
- `subject` TEXT NOT NULL
- `body_html` TEXT NOT NULL
- `recipient_filter` TEXT NOT NULL (all, attendees, unregistered, custom)
- `status` TEXT NOT NULL DEFAULT 'DRAFT' (DRAFT, QUEUED, SENDING, SENT, FAILED)
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### 23. `email_queue`
Individual email sending jobs.
- `id` TEXT PRIMARY KEY (UUID)
- `campaign_id` TEXT REFERENCES email_campaigns(id) ON DELETE CASCADE
- `event_id` TEXT REFERENCES events(id) ON DELETE CASCADE
- `recipient_email` TEXT NOT NULL
- `recipient_name` TEXT NOT NULL
- `variables_json` TEXT NOT NULL (e.g., recipient_name, certificate_id, drive_link, etc.)
- `status` TEXT NOT NULL DEFAULT 'PENDING' (PENDING, SENT, FAILED)
- `attempt_count` INTEGER DEFAULT 0
- `last_error` TEXT
- `next_retry` DATETIME
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### 24. `email_logs`
Completed email attempts audit trail.
- `id` TEXT PRIMARY KEY (UUID)
- `queue_id` TEXT
- `event_id` TEXT
- `recipient` TEXT NOT NULL
- `subject` TEXT NOT NULL
- `status` TEXT NOT NULL
- `error` TEXT
- `provider_message_id` TEXT
- `timestamp` DATETIME DEFAULT CURRENT_TIMESTAMP

### 25. `audit_logs`
System-wide security auditing.
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT
- `user_email` TEXT
- `action` TEXT NOT NULL
- `target_type` TEXT NOT NULL (user, department, event, registration, claim, certificate, email, settings)
- `target_id` TEXT
- `details` TEXT NOT NULL (JSON summary of action)
- `ip_address` TEXT
- `timestamp` DATETIME DEFAULT CURRENT_TIMESTAMP

### 26. `sessions`
Authentication sessions (for validation, rotation, and logout).
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT REFERENCES users(id) ON DELETE CASCADE
- `token` TEXT UNIQUE NOT NULL
- `expires_at` DATETIME NOT NULL
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

## Indexing Strategy
To ensure optimal performance and eliminate `SELECT *` table scans:
- Index on `events(slug)` (Unique)
- Index on `event_registrations(event_id, email)` (Unique)
- Index on `event_registrations(event_id, registration_id)` (Unique)
- Index on `attendance(event_id, registration_id, attendance_type)` (Unique)
- Index on `resource_claims(event_id, registration_id, resource_id)` (Unique)
- Index on `certificate_records(id)` (Primary/Unique for verification)
- Index on `audit_logs(timestamp)` and `audit_logs(user_id)`
- Index on `email_queue(status, next_retry)`

---

## Migrations

Apply migrations with the repo's runner, from `backend/`:

```bash
npm run db:migrate              # local
npm run db:migrate -- --remote  # production
```

| File | Purpose |
| --- | --- |
| `0001_schema.sql` | Full base schema (all tables + indexes). |
| `0002_rbac.sql` | Incremental RBAC objects for databases created before 0001 included them. |
| `0003_add_password_set.sql` | Repairs `users.password_set` on databases that applied 0001 before that column was added to it. |

### Schema drift repair (0003)

`users.password_set` was added to `0001_schema.sql` *after* 0001 had already been
applied to existing databases. Those databases therefore report 0001 and 0002 as
applied in `d1_migrations` while their `users` table has no `password_set`
column, and `wrangler d1 migrations apply` correctly reports "No migrations to
apply". Every staff INSERT (`POST /staff/department-heads`, `/coordinators`,
`/volunteers`) then fails with:

```
D1_ERROR: table users has no column named password_set
```

`0003_add_password_set.sql` fixes this **without** rewriting 0001/0002 history.

Two constraints shape how it is applied:

1. SQLite/D1 has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so the file
   cannot guard itself — running it on a fresh database (where 0001 already
   creates the column) fails with `duplicate column name: password_set`.
2. Rebuilding `users` (`CREATE new` + `DROP`/`RENAME`) is **data-destructive** on
   D1: the drop fires `ON DELETE CASCADE` and wipes `department_members`,
   `event_members`, `sessions` and `account_setup_tokens`. D1 does not allow
   `PRAGMA foreign_keys = off`, and `defer_foreign_keys` does not stop cascades.

So `npm run db:migrate` (`backend/scripts/migrate.mjs`) inspects the live schema
before delegating to wrangler:

| Database state | Action |
| --- | --- |
| `users.password_set` missing (legacy / production) | 0003 is **executed**, adding the column in place. |
| Fresh database, or column already present | 0003 is **recorded as applied without executing it**. |
| 0003 already in `d1_migrations` | No-op. |

Both paths converge on an identical `users` schema, and the runner verifies
`users.password_set` exists afterwards, exiting non-zero if it does not.

Verify manually at any time:

```bash
npx wrangler d1 execute dsmnru-eventhub-db --local --command "PRAGMA table_info(users);"
```
