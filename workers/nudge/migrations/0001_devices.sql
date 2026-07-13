CREATE TABLE IF NOT EXISTS nudge_devices (
  device_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  nudge_enabled INTEGER NOT NULL DEFAULT 1 CHECK (nudge_enabled IN (0, 1)),
  preferred_minute_jst INTEGER NOT NULL DEFAULT 1110 CHECK (preferred_minute_jst BETWEEN 390 AND 1290),
  last_completed_at INTEGER,
  next_nudge_at INTEGER,
  last_nudged_completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS nudge_due_idx
  ON nudge_devices (nudge_enabled, next_nudge_at);
