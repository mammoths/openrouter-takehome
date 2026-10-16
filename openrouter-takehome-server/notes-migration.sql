-- Apply only to the dedicated OpenRouter take-home DB. Existing videos, budgets,
-- selections and encrypted credentials are untouched. Safe to apply again.
CREATE TABLE IF NOT EXISTS takehome_video_notes (
  job_id TEXT PRIMARY KEY REFERENCES takehome_jobs(id),
  note TEXT NOT NULL CHECK (length(note) <= 2000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL
);
