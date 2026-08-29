// 读取笔记 JSON 并入库（UPSERT，按 note_id 去重；合并收藏/点赞两个来源）
// 用法：node server/ingest.mjs [notes.json 路径，默认 ../notes.json]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const fileArg = args.find(a => !a.startsWith('--'));
const sourceArg = args.find(a => a.startsWith('--source='));
const forcedSource = sourceArg ? sourceArg.split('=')[1] : null;
const notesPath = fileArg || process.env.XHS_NOTES || path.join(__dirname, '..', 'notes.json');

// 把 "2.9万" / "10万+" / "637" 转成数值，便于排序
function parseLikedNum(s) {
  if (s == null || s === '') return 0;
  const str = String(s).trim();
  if (str.includes('万')) {
    const n = parseFloat(str.replace('万', '').replace('+', ''));
    return isNaN(n) ? 0 : Math.round(n * 10000);
  }
  const n = parseInt(str.replace(/[^\d]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

const data = JSON.parse(readFileSync(notesPath, 'utf8'));
const notes = data.notes || [];
const capturedAt = data.meta?.captured_at || new Date().toISOString();

const db = openDb();
const upsert = db.prepare(`
  INSERT INTO notes (
    note_id, title, type, xsec_token, cover_url, cover_urls,
    author_id, author_name, author_avatar, author_xsec_token,
    liked_count, liked, liked_num, source, is_collected, is_liked, note_url, collected_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(note_id) DO UPDATE SET
    title=excluded.title, type=excluded.type, cover_url=excluded.cover_url,
    cover_urls=excluded.cover_urls, author_id=excluded.author_id,
    author_name=excluded.author_name, author_avatar=excluded.author_avatar,
    author_xsec_token=excluded.author_xsec_token, liked_count=excluded.liked_count,
    liked=MAX(liked, excluded.liked), liked_num=excluded.liked_num,
    is_collected=MAX(is_collected, excluded.is_collected),
    is_liked=MAX(is_liked, excluded.is_liked),
    note_url=excluded.note_url
`);

let n = 0, unknown = 0;
for (const note of notes) {
  if (!note || !note.note_id) continue;
  const src = forcedSource || note.source || 'collect';
  const isCollect = src === 'collect';
  const isLiked = src === 'liked';
  if (!isCollect && !isLiked) unknown++;

  upsert.run(
    note.note_id,
    note.title ?? '',
    note.type ?? 'normal',
    note.xsec_token ?? '',
    note.cover_url ?? '',
    JSON.stringify(note.cover_urls || []),
    note.author_id ?? '',
    note.author_name ?? '',
    note.author_avatar ?? '',
    note.author_xsec_token ?? '',
    note.liked_count ?? '',
    note.liked ? 1 : 0,
    parseLikedNum(note.liked_count),
    src,
    isCollect ? 1 : 0,
    isLiked ? 1 : 0,
    note.note_url ?? '',
    capturedAt
  );
  n++;
}

const total = db.prepare('SELECT COUNT(*) c FROM notes').get().c;
const collected = db.prepare('SELECT COUNT(*) c FROM notes WHERE is_collected=1').get().c;
const liked = db.prepare('SELECT COUNT(*) c FROM notes WHERE is_liked=1').get().c;
console.log(`入库 ${n} 条（${unknown ? unknown + ' 条来源未知，' : ''}UPSERT 去重）`);
console.log(`notes 表总数: ${total}，其中收藏 ${collected}，点赞 ${liked}`);
