// 本地知识库服务：REST API + 静态前端
// 零依赖，Node 内置 http + node:sqlite
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';
import { FILES_DIR, FILE_MIME, isInlineExt, registerLocalFile } from './files.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, '..', 'web');
const PORT = Number(process.env.XHS_PORT || 8787);

const db = openDb();

function getLanIps() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      // 过滤掉 169.254.x（Windows 无 DHCP 时自动分配的链路本地地址，手机连不上）
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

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

function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大（上限 64MB）')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 上传文件名消毒：去路径、去非法字符
function sanitizeName(name) {
  name = path.basename(String(name || ''));
  name = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!name || name === '.' || name === '..') return null;
  if (Buffer.byteLength(name, 'utf8') > 200) name = name.slice(0, 80) + path.extname(name);
  return name;
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
  const tag = params.get('tag');
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
  if (tag) { where.push('tags LIKE ?'); args.push(`%"${tag.replace(/"/g, '')}"%`); }
  if (q) {
    const like = `%${q}%`;
    where.push('(title LIKE ? OR summary LIKE ? OR tags LIKE ? OR subcategory LIKE ? OR author_name LIKE ? OR desc LIKE ?)');
    args.push(like, like, like, like, like, like);
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

function getTags(app) {
  const rows = db.prepare(
    "SELECT tags FROM notes WHERE tags IS NOT NULL AND tags != ''" + (app ? ' AND app = ?' : '')
  ).all(...(app ? [app] : []));
  const counts = {};
  for (const r of rows) {
    for (const t of parseJsonArray(r.tags)) {
      if (t && typeof t === 'string') counts[t] = (counts[t] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([tag, c]) => ({ tag, c }))
    .sort((a, b) => b.c - a.c);
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

function getRelated(note) {
  const noteTags = parseJsonArray(note.tags);
  const all = db.prepare('SELECT * FROM notes WHERE note_id != ?').all(note.note_id);
  return all.map(other => {
    let score = 0;
    const reasons = [];
    const otherTags = parseJsonArray(other.tags);
    if (note.category && other.category === note.category) { score += 5; reasons.push('同分类'); }
    if (note.subcategory && other.subcategory === note.subcategory) { score += 8; reasons.push('同小类'); }
    if (note.author_name && other.author_name === note.author_name) { score += 2; reasons.push('同作者'); }
    if (note.folder && other.folder === note.folder) { score += 4; reasons.push('同收藏夹'); }
    const shared = noteTags.filter(t => otherTags.includes(t));
    if (shared.length) { score += shared.length * 3; reasons.push(`共享标签×${shared.length}`); }
    return { other, score, reason: reasons.join(' · ') };
  })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(x => ({ note: rowToNote(x.other), score: x.score, reason: x.reason }));
}

function getGraph() {
  const catRows = db.prepare('SELECT category, COUNT(*) c FROM notes WHERE category IS NOT NULL GROUP BY category').all();
  const nodes = catRows.map(r => ({ id: r.category, count: r.c }));

  // 每个分类的标签集合
  const catTags = {};
  const rows = db.prepare("SELECT category, tags FROM notes WHERE category IS NOT NULL AND tags IS NOT NULL AND tags != ''").all();
  for (const r of rows) {
    if (!catTags[r.category]) catTags[r.category] = new Set();
    for (const t of parseJsonArray(r.tags)) catTags[r.category].add(t);
  }

  // 分类两两共享标签 → 边
  const edges = [];
  const names = Object.keys(catTags);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      const shared = [];
      for (const t of catTags[a]) if (catTags[b].has(t)) shared.push(t);
      if (shared.length > 0) edges.push({ source: a, target: b, weight: shared.length, tags: shared.slice(0, 6) });
    }
  }
  return { nodes, edges };
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
      if (n.app === 'local') lines.push(`本地文件：data/files/${n.title}`);
      else if (n.note_url) lines.push(`原文：${n.note_url}`);
      if (n.cover_url) lines.push(`封面：${n.cover_url}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/api/upload' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const name = sanitizeName(body.name);
      if (!name) return send(res, 400, { error: '文件名不合法' });
      const buf = Buffer.from(body.data || '', 'base64');
      if (!buf.length) return send(res, 400, { error: '文件内容为空' });
      const note = registerLocalFile(db, name, buf);
      return send(res, 200, { ok: true, note });
    }
    if (pathname.startsWith('/files/')) {
      const rel = decodeURIComponent(pathname.slice('/files/'.length));
      const full = path.resolve(FILES_DIR, rel);
      if (!full.startsWith(FILES_DIR + path.sep)) return send(res, 404, { error: 'not found' });
      if (!existsSync(full) || !statSync(full).isFile()) return send(res, 404, { error: 'not found' });
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, {
        'Content-Type': FILE_MIME[ext] || 'application/octet-stream',
        'Content-Disposition': isInlineExt(ext) ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(full))}`,
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(readFileSync(full));
    }
    if (pathname === '/api/stats') return send(res, 200, getStats());
    if (pathname === '/api/graph') return send(res, 200, getGraph());
    if (pathname === '/api/info') {
      const lanIps = getLanIps();
      return send(res, 200, { port: PORT, lanIps, urls: lanIps.map(ip => `http://${ip}:${PORT}`) });
    }
    if (pathname === '/api/categories') return send(res, 200, getCategories(url.searchParams.get('app')));
    if (pathname === '/api/tags') return send(res, 200, getTags(url.searchParams.get('app')));
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
    if (pathname.startsWith('/api/notes/') && pathname.endsWith('/related')) {
      const id = pathname.slice('/api/notes/'.length, -'/related'.length);
      const note = getNote(id);
      if (!note) return send(res, 404, { error: 'not found' });
      return send(res, 200, { note, related: getRelated(note) });
    }
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`知识库服务已启动:`);
  console.log(`  本机: http://localhost:${PORT}`);
  for (const ip of getLanIps()) {
    console.log(`  局域网: http://${ip}:${PORT}`);
  }
});
