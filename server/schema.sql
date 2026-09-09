PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS league_records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (collection, id)
);
PRAGMA user_version = 1;
