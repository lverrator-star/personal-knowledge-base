import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.XHS_DB || path.join(dataDir, 'xhs.db');

let db;

export function openDb() {
  if (db) return db;
  mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      note_id         TEXT PRIMARY KEY,
      title           TEXT,
      type            TEXT,
      xsec_token      TEXT,
      cover_url       TEXT,
      cover_urls      TEXT,
      author_id       TEXT,
      author_name     TEXT,
      author_avatar   TEXT,
      author_xsec_token TEXT,
      liked_count     TEXT,
      liked           INTEGER,
      liked_num       INTEGER,
      source          TEXT,
      app             TEXT DEFAULT 'xhs',
      folder          TEXT,
      desc            TEXT,
      is_collected    INTEGER DEFAULT 0,
      is_liked        INTEGER DEFAULT 0,
      note_url        TEXT,
      collected_at    TEXT,
      category        TEXT,
      subcategory     TEXT,
      summary         TEXT,
      tags            TEXT,
      classified_at   TEXT,
      reviewed        INTEGER DEFAULT 0,
      last_reviewed   TEXT,
      timeliness      INTEGER,
      breadth         INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);
    CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(type);
  `);

  // 迁移：旧库补列
  const cols = db.prepare('PRAGMA table_info(notes)').all().map(c => c.name);
  if (!cols.includes('subcategory')) db.exec('ALTER TABLE notes ADD COLUMN subcategory TEXT');
  if (!cols.includes('liked_num')) db.exec('ALTER TABLE notes ADD COLUMN liked_num INTEGER');
  if (!cols.includes('app')) db.exec("ALTER TABLE notes ADD COLUMN app TEXT DEFAULT 'xhs'");
  if (!cols.includes('folder')) db.exec('ALTER TABLE notes ADD COLUMN folder TEXT');
  if (!cols.includes('desc')) db.exec('ALTER TABLE notes ADD COLUMN desc TEXT');
  if (!cols.includes('reviewed')) db.exec('ALTER TABLE notes ADD COLUMN reviewed INTEGER DEFAULT 0');
  if (!cols.includes('last_reviewed')) db.exec('ALTER TABLE notes ADD COLUMN last_reviewed TEXT');
  if (!cols.includes('timeliness')) db.exec('ALTER TABLE notes ADD COLUMN timeliness INTEGER');
  if (!cols.includes('breadth')) db.exec('ALTER TABLE notes ADD COLUMN breadth INTEGER');
  if (!cols.includes('is_collected')) {
    db.exec('ALTER TABLE notes ADD COLUMN is_collected INTEGER DEFAULT 0');
    db.exec("UPDATE notes SET is_collected = 1 WHERE source = 'collect'");
  }
  if (!cols.includes('is_liked')) {
    db.exec('ALTER TABLE notes ADD COLUMN is_liked INTEGER DEFAULT 0');
    db.exec("UPDATE notes SET is_liked = liked WHERE source = 'collect'");
  }

  // liked_num 索引在补列之后建，避免旧库报 no such column
  db.exec('CREATE INDEX IF NOT EXISTS idx_notes_liked_num ON notes(liked_num)');

  return db;
}
