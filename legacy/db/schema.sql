-- Routy v2 Schema (MySQL 8+)

CREATE TABLE IF NOT EXISTS nodes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NULL,
  latitude DOUBLE NOT NULL,
  longitude DOUBLE NOT NULL,
  UNIQUE KEY uniq_latlon (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS segments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(512) NULL,
  start_node_id INT NOT NULL,
  end_node_id INT NOT NULL,
  length_m INT NOT NULL,
  duration_min INT NOT NULL,
  geom_json JSON NOT NULL,
  geom_hash CHAR(40) NULL,
  FOREIGN KEY (start_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (end_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_segment (start_node_id, end_node_id, geom_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS segment_usage (
  segment_id INT PRIMARY KEY,
  usage_count INT NOT NULL DEFAULT 0,
  FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- gpx_sources mit Hash-PK (keine Key-Length-Probleme)
CREATE TABLE IF NOT EXISTS gpx_sources (
  filename       VARCHAR(512) NOT NULL,
  track_name     VARCHAR(512) NOT NULL,
  filename_hash  CHAR(40)     NOT NULL,
  track_hash     CHAR(40)     NOT NULL,
  mtime          BIGINT       NOT NULL,
  geom_hash      CHAR(40)     NOT NULL,
  segment_id     INT          NOT NULL,
  PRIMARY KEY (filename_hash, track_hash),
  KEY gpx_sources_seg (segment_id),
  CONSTRAINT fk_gpx_seg FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Routen-Vorkalkulation: ID-Kette statt Namen
CREATE TABLE IF NOT EXISTS routes_precalc (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chain_sig VARCHAR(1024) NOT NULL,   -- z. B. "21-33-21"
  node_chain_json JSON NOT NULL,      -- z. B. [21,33,21]
  segment_ids_json JSON NOT NULL,
  length_m INT NOT NULL,
  duration_min INT NOT NULL,
  UNIQUE KEY uniq_chain (chain_sig),
  KEY len_idx (length_m),
  KEY dur_idx (duration_min)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
