// 本地知识库服务：REST API + 静态前端
// 零依赖，Node 内置 http + node:sqlite
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, '..', 'web');
const PORT = Number(process.env.XHS_PORT || 8787);

const db = openDb();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
  if (Buffer.isBuffer(body)) return res.end(body);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function sendDownload(res, filename, contentType, body) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function parseJsonArray(s, fallback = []) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function rowToNote(r) {
  if (!r) return null;
  return {
    ...r,
    cover_urls: parseJsonArray(r.cover_urls),
    tags: parseJsonArray(r.tags),
    liked: !!r.liked,
  };
}

function getStats() {
  const total = db.prepare('SELECT COUNT(*) c FROM notes').get().c;
  const classified = db.prepare('SELECT COUNT(*) c FROM notes WHERE category IS NOT NULL').get().c;
  const typeRows = db.prepare('SELECT type, COUNT(*) c FROM notes GROUP BY type').all();
  const catRows = db.prepare(
    'SELECT category, COUNT(*) c FROM notes WHERE category IS NOT NULL GROUP BY category ORDER BY c DESC'
  ).all();
  const subRows = db.prepare(
    'SELECT category, subcategory, COUNT(*) c FROM notes WHERE subcategory IS NOT NULL GROUP BY category, subcategory ORDER BY c DESC'
  ).all();
  const collected = db.prepare('SELECT COUNT(*) c FROM notes WHERE is_collected=1').get().c;
  const liked = db.prepare('SELECT COUNT(*) c FROM notes WHERE is_liked=1').get().c;
  const appRows = db.prepare('SELECT app, COUNT(*) c FROM notes GROUP BY app').all();
  const folderRows = db.prepare(
    "SELECT app, folder, COUNT(*) c FROM notes WHERE folder IS NOT NULL AND folder != '' GROUP BY app, folder ORDER BY c DESC"
  ).all();
  const authorRows = db.prepare(
    "SELECT author_name, COUNT(*) c FROM notes WHERE author_name IS NOT NULL AND author_name != '' GROUP BY author_name ORDER BY c DESC LIMIT 8"
  ).all();
  return {
    total,
    classified,
    collected,
    liked,
    apps: Object.fromEntries(appRows.map(r => [r.app, r.c])),
    folders: folderRows,
    authors: authorRows,
    types: Object.fromEntries(typeRows.map(r => [r.type, r.c])),
    categories: catRows,
    subcategories: subRows,
  };
}

function listNotes(params) {
  const where = [];
  const args = [];
  const category = params.get('category');
  const subcategory = params.get('subcategory');
  const type = params.get('type');
  const source = params.get('source');
  const app = params.get('app');
  const folder = params.get('folder');
  const q = params.get('q');
  const unclassified = params.get('unclassified');

  if (category) { where.push('category = ?'); args.push(category); }
  if (subcategory) { where.push('subcategory = ?'); args.push(subcategory); }
  if (type) { where.push('type = ?'); args.push(type); }
  if (app) { where.push('app = ?'); args.push(app); }
  if (folder) { where.push('folder = ?'); args.push(folder); }
  if (source === 'collect') { where.push('is_collected = 1'); }
  else if (source === 'liked') { where.push('is_liked = 1'); }
  else if (source) { where.push('source = ?'); args.push(source); }
  if (unclassified === '1') { where.push('category IS NULL'); }
  if (q) {
    const like = `%${q}%`;
    where.push('(title LIKE ? OR summary LIKE ? OR tags LIKE ? OR subcategory LIKE ? OR author_name LIKE ?)');
    args.push(like, like, like, like, like);
  }

  const sort = params.get('sort');
  let orderBy = 'ORDER BY collected_at DESC, rowid DESC';
  if (sort === 'liked') orderBy = 'ORDER BY liked_num DESC, rowid DESC';

  const limit = Math.min(Number(params.get('limit') || 100), 500);
  const offset = Number(params.get('offset') || 0);

  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare('SELECT * FROM notes' + whereSql + ' ' + orderBy + ' LIMIT ? OFFSET ?').all(...args, limit, offset);
  const total = db.prepare('SELECT COUNT(*) c FROM notes' + whereSql).get(...args).c;

  return { total, notes: rows.map(rowToNote) };
}

function getNote(id) {
  return rowToNote(db.prepare('SELECT * FROM notes WHERE note_id = ?').get(id));
}

function getCategories(app) {
  if (app) {
    return db.prepare(
      'SELECT category, COUNT(*) c FROM notes WHERE category IS NOT NULL AND app = ? GROUP BY category ORDER BY c DESC'
    ).all(app);
  }
  return db.prepare(
    'SELECT category, COUNT(*) c FROM notes WHERE category IS NOT NULL GROUP BY category ORDER BY c DESC'
  ).all();
}

function getReview(params) {
  const n = Math.min(Number(params.get('n') || 8), 20);
  const app = params.get('app');
  const whereApp = app ? ' WHERE app = ?' : '';
  const args = app ? [app] : [];

  const total = db.prepare('SELECT COUNT(*) c FROM notes' + whereApp).get(...args).c;
  const reviewed = db.prepare('SELECT COUNT(*) c FROM notes WHERE reviewed=1' + (app ? ' AND app = ?' : '')).get(...args).c;
  const unreviewed = total - reviewed;

  let notes;
  if (unreviewed > 0) {
    notes = db.prepare(
      'SELECT * FROM notes WHERE reviewed=0' + (app ? ' AND app = ?' : '') + ' ORDER BY RANDOM() LIMIT ?'
    ).all(...args, n);
  } else {
    notes = db.prepare('SELECT * FROM notes' + whereApp + ' ORDER BY RANDOM() LIMIT ?').all(...args, n);
  }
  return { total, reviewed, unreviewed, notes: notes.map(rowToNote) };
}

function buildMarkdown(notes) {
  const lines = [];
  lines.push('# 个人知识库导出');
  lines.push(`> 共 ${notes.length} 条 · 导出时间 ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');

  const byCat = new Map();
  for (const n of notes) {
    const c = n.category || '未分类';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(n);
  }

  for (const [cat, list] of byCat) {
    lines.push(`## ${cat}（${list.length}）`);
    lines.push('');
    for (const n of list) {
      const sub = n.subcategory ? ` · ${n.subcategory}` : '';
      lines.push(`### ${n.title}${sub}`);
      lines.push('');
      const meta = [];
      if (n.author_name) meta.push(`作者：${n.author_name}`);
      meta.push(`类型：${n.type === 'video' ? '视频' : '图文'}`);
      if (n.liked_count) meta.push(`点赞：${n.liked_count}`);
      if (n.tags && n.tags.length) meta.push(`标签：${n.tags.join('、')}`);
      lines.push(meta.join(' ｜ '));
      if (n.summary) lines.push(`摘要：${n.summary}`);
      if (n.note_url) lines.push(`原文：${n.note_url}`);
      if (n.cover_url) lines.push(`封面：${n.cover_url}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/api/stats') return send(res, 200, getStats());
    if (pathname === '/api/categories') return send(res, 200, getCategories(url.searchParams.get('app')));
    if (pathname === '/api/review' && req.method === 'GET') return send(res, 200, getReview(url.searchParams));
    if (pathname === '/api/review/reset' && req.method === 'POST') {
      db.prepare('UPDATE notes SET reviewed=0, last_reviewed=NULL').run();
      return send(res, 200, { ok: true });
    }
    if (pathname.startsWith('/api/review/') && req.method === 'POST') {
      const id = pathname.slice('/api/review/'.length);
      db.prepare('UPDATE notes SET reviewed=1, last_reviewed=? WHERE note_id=?').run(new Date().toISOString(), id);
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/notes') return send(res, 200, listNotes(url.searchParams));
    if (pathname.startsWith('/api/notes/')) {
      const id = pathname.slice('/api/notes/'.length);
      const note = getNote(id);
      if (!note) return send(res, 404, { error: 'not found' });
      return send(res, 200, note);
    }
    if (pathname === '/api/export') {
      const format = url.searchParams.get('format') || 'md';
      const all = db.prepare('SELECT * FROM notes ORDER BY category, liked_num DESC').all().map(rowToNote);
      if (format === 'json') {
        return sendDownload(res, 'personal-kb.json', 'application/json; charset=utf-8',
          JSON.stringify({ total: all.length, notes: all }, null, 2));
      }
      return sendDownload(res, 'personal-kb.md', 'text/markdown; charset=utf-8', buildMarkdown(all));
    }

    // 静态前端
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const full = path.join(webDir, filePath);
    if (existsSync(full) && statSync(full).isFile()) {
      const ext = path.extname(full).toLowerCase();
      return send(res, 200, readFileSync(full), MIME[ext] || 'application/octet-stream');
    }
    return send(res, 404, { error: 'not found', path: pathname });
  } catch (e) {
    return send(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, () => {
  console.log(`知识库服务已启动: http://localhost:${PORT}`);
});
