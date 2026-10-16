-- Apply to the dedicated take-home DB binding only. No office tables are used.
CREATE TABLE IF NOT EXISTS takehome_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS takehome_comparisons (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  preset_id TEXT NOT NULL CHECK (preset_id IN ('skateboard', 'stairs', 'bed')),
  prompt TEXT NOT NULL,
  references_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  estimated_microusd INTEGER NOT NULL,
  selected_job_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_poll_at INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'compare' CHECK (mode IN ('compare','draft')),
  second_request_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS takehome_one_active_preset
  ON takehome_comparisons(preset_id) WHERE active = 1;
CREATE INDEX IF NOT EXISTS takehome_comparisons_created
  ON takehome_comparisons(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS takehome_second_request_unique
  ON takehome_comparisons(second_request_id) WHERE second_request_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS takehome_jobs (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL REFERENCES takehome_comparisons(id),
  slot INTEGER NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  upstream_job_id TEXT UNIQUE,
  estimated_microusd INTEGER NOT NULL,
  actual_cost REAL,
  error TEXT,
  submission_status TEXT NOT NULL DEFAULT 'planned',
  error_status INTEGER,
  error_details_json TEXT NOT NULL DEFAULT '{}',
  resolution TEXT NOT NULL DEFAULT '720p',
  duration INTEGER NOT NULL DEFAULT 4,
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(comparison_id, slot)
);
CREATE TABLE IF NOT EXISTS takehome_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cap_microusd INTEGER NOT NULL DEFAULT 20000000 CHECK (cap_microusd = 20000000),
  reserved_microusd INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO takehome_budget(id, cap_microusd, reserved_microusd)
  VALUES (1, 20000000, 0);
-- Reservations are cumulative and conservative, including failed/unknown submissions.
CREATE TABLE IF NOT EXISTS takehome_reservations (
  comparison_id TEXT PRIMARY KEY REFERENCES takehome_comparisons(id),
  estimated_microusd INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS takehome_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- This releases local estimates only, never claims a provider credit/refund.
CREATE TABLE IF NOT EXISTS takehome_reservation_releases (
  job_id TEXT PRIMARY KEY REFERENCES takehome_jobs(id),
  comparison_id TEXT NOT NULL REFERENCES takehome_comparisons(id),
  released_microusd INTEGER NOT NULL,
  batch_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- Shared by authenticated demo viewers only; excluded from public comparisons.
CREATE TABLE IF NOT EXISTS takehome_video_notes (
  job_id TEXT PRIMARY KEY REFERENCES takehome_jobs(id),
  note TEXT NOT NULL CHECK (length(note) <= 2000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL
);
