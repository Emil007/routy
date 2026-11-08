CREATE TABLE achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE active_route (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  node_chain TEXT NOT NULL,
  segment_ids TEXT NOT NULL,
  length_m INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now'))
, nickname TEXT, walk_mode TEXT NOT NULL DEFAULT 'route', guide_node_ids TEXT);

CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE crash_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  stack TEXT,
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE favorite_route (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  node_chain TEXT NOT NULL,
  segment_ids TEXT NOT NULL,
  length_m INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, share_token TEXT, share_expires_at TEXT);

CREATE TABLE free_roam_completed (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  walk_id INTEGER REFERENCES walk_log(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, started_at)
);

CREATE TABLE golden_segments (
      utc_date TEXT NOT NULL,
      segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      multiplier REAL NOT NULL DEFAULT 3.0,
      PRIMARY KEY (utc_date, segment_id)
    );

CREATE TABLE name_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, display_text TEXT, speak_text TEXT);

CREATE TABLE nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  is_home INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, created_by INTEGER REFERENCES users(id), name_part_1_id INTEGER REFERENCES name_parts(id), name_part_2_id INTEGER REFERENCES name_parts(id), name_separator TEXT NOT NULL DEFAULT '/', active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, updated_at TEXT, open_from_minutes INTEGER, open_until_minutes INTEGER);

CREATE TABLE segment_condition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  reported_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE segment_first_recording (
      canonical_segment_id INTEGER PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
      walk_id INTEGER NOT NULL REFERENCES walk_log(id) ON DELETE CASCADE,
      points_json TEXT NOT NULL
    );

CREATE TABLE segment_geometry_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
          geometry_json TEXT NOT NULL,
          length_m REAL,
          ele_gain_m REAL,
          ele_loss_m REAL,
          duration_min REAL,
          backed_up_at TEXT NOT NULL DEFAULT (datetime('now')),
          reason TEXT
        );

CREATE TABLE segment_lock_proposal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT,
      days INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE segment_proposal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE segment_usage (
  segment_id INTEGER PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT
);

CREATE TABLE segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  end_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  geometry TEXT NOT NULL,
  length_m INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  ele_gain_m INTEGER,
  ele_loss_m INTEGER,
  ele_min_m INTEGER,
  ele_max_m INTEGER,
  source TEXT NOT NULL DEFAULT 'gpx',
  reverse_of INTEGER REFERENCES segments(id) ON DELETE CASCADE,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, name TEXT, active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, locked_until TEXT, locked_reason TEXT, updated_at TEXT, duration_from_gps INTEGER NOT NULL DEFAULT 0, one_way INTEGER NOT NULL DEFAULT 0);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
, session_id TEXT, device_name TEXT, client TEXT NOT NULL DEFAULT 'web');

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE track_geometry_dismissals (
          walk_id INTEGER NOT NULL REFERENCES walk_log(id) ON DELETE CASCADE,
          segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
          dismissed_at TEXT NOT NULL DEFAULT (datetime('now')), resolution TEXT NOT NULL DEFAULT 'discarded',
          PRIMARY KEY (walk_id, segment_id)
        );

CREATE TABLE user_avoid_segment (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT, reason TEXT,
  PRIMARY KEY (user_id, segment_id)
);

CREATE TABLE user_segment_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  PRIMARY KEY (user_id, segment_id)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'de',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, walk_speed_kmh REAL, role TEXT NOT NULL DEFAULT 'user', active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, theme TEXT NOT NULL DEFAULT 'auto', totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, home_node_id INTEGER REFERENCES nodes(id), taste_short_m REAL, taste_normal_m REAL, taste_long_m REAL, timezone TEXT NOT NULL DEFAULT 'Europe/Vienna', totp_pending_secret TEXT);

CREATE TABLE walk_geometry_analysis (
      walk_id INTEGER PRIMARY KEY REFERENCES walk_log(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      suggestions_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      analyzed_at TEXT,
      trashed_at TEXT
    );

CREATE TABLE walk_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_chain TEXT NOT NULL,
  segment_ids TEXT NOT NULL,
  length_m INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now'))
, nickname TEXT, points_earned INTEGER, points_base INTEGER, points_golden INTEGER, points_exploration INTEGER, points_diversity INTEGER, streak_multiplier REAL, celebration_tier TEXT, golden_hits INTEGER, length_rating INTEGER, track_json TEXT);

CREATE TABLE walk_track (
          walk_id INTEGER PRIMARY KEY REFERENCES walk_log(id) ON DELETE CASCADE,
          points_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
