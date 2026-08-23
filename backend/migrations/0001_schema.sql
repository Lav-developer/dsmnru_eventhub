-- Migration: 0001_schema.sql

-- 1. users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK(role IN ('super_admin', 'department_head', 'coordinator', 'volunteer')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. departments
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. department_members
CREATE TABLE IF NOT EXISTS department_members (
  department_id TEXT REFERENCES departments(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (department_id, user_id)
);

-- 4. events
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  theme TEXT,
  description TEXT,
  banner_url TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  venue TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('online', 'offline', 'hybrid')),
  meeting_link TEXT,
  registration_type TEXT NOT NULL CHECK(registration_type IN ('built_in', 'external')),
  external_form_url TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ONGOING', 'COMPLETED', 'ARCHIVED')),
  google_drive_folder_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. event_members
CREATE TABLE IF NOT EXISTS event_members (
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('coordinator', 'volunteer')),
  PRIMARY KEY (event_id, user_id)
);

-- 6. registration_fields
CREATE TABLE IF NOT EXISTS registration_fields (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT,
  field_type TEXT NOT NULL CHECK(field_type IN ('text', 'textarea', 'number', 'dropdown', 'radio', 'checkbox', 'date')),
  required INTEGER DEFAULT 0,
  options TEXT, -- JSON array
  field_order INTEGER DEFAULT 0,
  UNIQUE(event_id, label)
);

-- 7. event_registrations
CREATE TABLE IF NOT EXISTS event_registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  registration_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  college TEXT NOT NULL,
  department TEXT NOT NULL,
  course TEXT NOT NULL,
  year TEXT NOT NULL,
  designation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, email),
  UNIQUE(event_id, registration_id)
);

-- 8. registration_responses
CREATE TABLE IF NOT EXISTS registration_responses (
  id TEXT PRIMARY KEY,
  registration_id TEXT REFERENCES event_registrations(id) ON DELETE CASCADE,
  field_id TEXT REFERENCES registration_fields(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  UNIQUE(registration_id, field_id)
);

-- 9. registration_imports
CREATE TABLE IF NOT EXISTS registration_imports (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  inserted_count INTEGER NOT NULL,
  updated_count INTEGER NOT NULL,
  duplicate_count INTEGER NOT NULL,
  rejected_count INTEGER NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 10. registration_import_errors
CREATE TABLE IF NOT EXISTS registration_import_errors (
  id TEXT PRIMARY KEY,
  import_id TEXT REFERENCES registration_imports(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_data TEXT NOT NULL, -- JSON object
  error_reason TEXT NOT NULL
);

-- 11. speakers
CREATE TABLE IF NOT EXISTS speakers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  designation TEXT NOT NULL,
  institution TEXT NOT NULL,
  photo_url TEXT,
  biography TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 12. event_speakers
CREATE TABLE IF NOT EXISTS event_speakers (
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  speaker_id TEXT REFERENCES speakers(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, speaker_id)
);

-- 13. schedule_items
CREATE TABLE IF NOT EXISTS schedule_items (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  speaker_name TEXT,
  location TEXT
);

-- 14. announcements
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high')),
  published_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 15. attendance
CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  registration_id TEXT REFERENCES event_registrations(id) ON DELETE CASCADE,
  scanner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  attendance_type TEXT NOT NULL DEFAULT 'event_entry',
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, registration_id, attendance_type)
);

-- 16. resources
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  eligibility TEXT NOT NULL DEFAULT 'all' CHECK(eligibility IN ('all', 'attendees')),
  claim_limit INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  UNIQUE(event_id, name)
);

-- 17. resource_claims
CREATE TABLE IF NOT EXISTS resource_claims (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  registration_id TEXT REFERENCES event_registrations(id) ON DELETE CASCADE,
  resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,
  scanner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, registration_id, resource_id)
);

-- 18. certificate_templates
CREATE TABLE IF NOT EXISTS certificate_templates (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  bg_image_url TEXT,
  layout_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 19. event_certificate_templates
CREATE TABLE IF NOT EXISTS event_certificate_templates (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bg_image_url TEXT,
  layout_json TEXT NOT NULL,
  certificate_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, certificate_type)
);

-- 20. certificate_records
CREATE TABLE IF NOT EXISTS certificate_records (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  registration_id TEXT REFERENCES event_registrations(id) ON DELETE CASCADE,
  participant_name TEXT NOT NULL,
  certificate_type TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 21. email_templates
CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 22. email_campaigns
CREATE TABLE IF NOT EXISTS email_campaigns (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  recipient_filter TEXT NOT NULL CHECK(recipient_filter IN ('all', 'attendees', 'unregistered', 'custom')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'QUEUED', 'SENDING', 'SENT', 'FAILED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 23. email_queue
CREATE TABLE IF NOT EXISTS email_queue (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES email_campaigns(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  variables_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'SENT', 'FAILED')),
  attempt_count INTEGER DEFAULT 0,
  last_error TEXT,
  next_retry TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 24. email_logs
CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  queue_id TEXT,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  provider_message_id TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 25. audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details TEXT NOT NULL,
  ip_address TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 26. sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create Indexes for performance and unique lookups
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
CREATE INDEX IF NOT EXISTS idx_registrations_event_id_email ON event_registrations(event_id, email);
CREATE INDEX IF NOT EXISTS idx_registrations_event_id_reg ON event_registrations(event_id, registration_id);
CREATE INDEX IF NOT EXISTS idx_attendance_lookup ON attendance(event_id, registration_id, attendance_type);
CREATE INDEX IF NOT EXISTS idx_resource_claims_lookup ON resource_claims(event_id, registration_id, resource_id);
CREATE INDEX IF NOT EXISTS idx_certificate_records_id ON certificate_records(id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_email_queue_status_retry ON email_queue(status, next_retry);
