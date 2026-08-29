// 读取知乎收藏 JSON 并入库（app='zhihu'，含 folder 收藏夹 + desc 正文摘要）
// 用法：node server/ingest-zhihu.mjs [zhihu-notes.json 路径]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fileArg = process.argv[2];
const notesPath = fileArg || path.join(__dirname, '..', 'zhihu-notes.json');

const data = JSON.parse(readFileSync(notesPath, 'utf8'));
const notes = data.notes || [];
const capturedAt = data.meta?.captured_at || new Date().toISOString();

const db = openDb();
const upsert = db.prepare(`
  INSERT INTO notes (note_id, title, type, author_name, note_url, folder, desc, app, collected_at)
  VALUES (?,?,?,?,?,?,?,?,?)
  ON CONFLICT(note_id) DO UPDATE SET
    title=excluded.title, type=excluded.type, author_name=excluded.author_name,
    note_url=excluded.note_url, folder=excluded.folder, desc=excluded.desc
`);

let n = 0;
for (const note of notes) {
  if (!note || !note.note_id) continue;
  upsert.run(
    String(note.note_id),
    note.title ?? '',
    note.type ?? '',
    note.author ?? '',
    note.url ?? '',
    note.folder ?? '',
    note.excerpt ?? '',
    'zhihu',
    capturedAt
  );
  n++;
}

const total = db.prepare('SELECT COUNT(*) c FROM notes WHERE app = ?').get('zhihu');
console.log(`入库知乎 ${n} 条（UPSERT），知乎笔记总数: ${total.c}`);
