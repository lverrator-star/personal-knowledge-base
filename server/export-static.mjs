// 生成静态预览站点（preview/ 目录），供 GitHub Pages 托管
// 用法：node server/export-static.mjs
// 原理：把全部数据内嵌进 data.js，并用 fetch 垫片模拟 /api/* 接口，
//       前端 app.js 几乎无需改动即可运行（只读 + 内存态回顾）。
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, '..', 'web');
const outDir = path.join(__dirname, '..', 'preview');

const db = openDb();

function parseJsonArray(s, fallback = []) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function rowToNote(r) {
  return {
    ...r,
    cover_urls: parseJsonArray(r.cover_urls),
    tags: parseJsonArray(r.tags),
    liked: !!r.liked,
  };
}

// ---------- 以下统计/图谱/导出逻辑与 server.mjs 保持一致 ----------
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

function getGraph() {
  const catRows = db.prepare('SELECT category, COUNT(*) c FROM notes WHERE category IS NOT NULL GROUP BY category').all();
  const nodes = catRows.map(r => ({ id: r.category, count: r.c }));
  const catTags = {};
  const rows = db.prepare("SELECT category, tags FROM notes WHERE category IS NOT NULL AND tags IS NOT NULL AND tags != ''").all();
  for (const r of rows) {
    if (!catTags[r.category]) catTags[r.category] = new Set();
    for (const t of parseJsonArray(r.tags)) catTags[r.category].add(t);
  }
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
      if (n.note_url) lines.push(`原文：${n.note_url}`);
      if (n.cover_url) lines.push(`封面：${n.cover_url}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ---------- 组装数据 ----------
// 预览只保留前端用到的字段，desc 截断（体积 + 版权友好）
const PICK = ['note_id', 'title', 'type', 'cover_url', 'author_name', 'author_avatar',
  'liked_count', 'liked_num', 'source', 'app', 'folder', 'desc', 'is_collected', 'is_liked',
  'note_url', 'collected_at', 'category', 'subcategory', 'summary', 'tags', 'timeliness', 'breadth'];
const notes = db.prepare('SELECT * FROM notes').all().map(rowToNote).map(n => {
  const t = {};
  for (const k of PICK) t[k] = n[k];
  if (t.desc && t.desc.length > 400) t.desc = t.desc.slice(0, 400) + '…';
  return t;
});
const DATA = {
  notes,
  stats: getStats(),
  categories: { '': getCategories(null), xhs: getCategories('xhs'), zhihu: getCategories('zhihu') },
  tags: { '': getTags(null), xhs: getTags('xhs'), zhihu: getTags('zhihu') },
  graph: getGraph(),
};

// ---------- fetch 垫片（模拟 /api/*）----------
const SHIM = String.raw`// 静态预览数据（由 server/export-static.mjs 生成，勿手改）
(function () {
  const D = window.KB_DATA;
  const db = { notes: D.notes, reviewed: new Set() };
  const realFetch = window.fetch.bind(window);

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function listNotes(q) {
    const cat = q.get('category'), sub = q.get('subcategory'), type = q.get('type'),
      source = q.get('source'), app = q.get('app'), folder = q.get('folder'),
      qq = q.get('q'), tag = q.get('tag'), uncl = q.get('unclassified'),
      sort = q.get('sort');
    let rows = db.notes.filter(n => {
      if (cat === '__unclassified__') { if (n.category) return false; }
      else if (cat && n.category !== cat) return false;
      if (sub && n.subcategory !== sub) return false;
      if (type && n.type !== type) return false;
      if (app && n.app !== app) return false;
      if (folder && n.folder !== folder) return false;
      if (source === 'collect') { if (!n.is_collected) return false; }
      else if (source === 'liked') { if (!n.is_liked) return false; }
      else if (source && n.source !== source) return false;
      if (uncl === '1' && n.category) return false;
      if (tag) { if (!(n.tags || []).includes(tag)) return false; }
      if (qq) {
        const s = qq.toLowerCase();
        const hit = [n.title, n.summary, (n.tags || []).join(' '), n.subcategory, n.author_name]
          .some(x => x && String(x).toLowerCase().includes(s));
        if (!hit) return false;
      }
      return true;
    });
    if (sort === 'liked') rows.sort((a, b) => (b.liked_num || 0) - (a.liked_num || 0));
    else rows.sort((a, b) => String(b.collected_at || '').localeCompare(String(a.collected_at || '')));
    const total = rows.length;
    const limit = Math.min(Number(q.get('limit') || 100), 500);
    const offset = Number(q.get('offset') || 0);
    return { total, notes: rows.slice(offset, offset + limit) };
  }

  function getRelated(note) {
    const noteTags = note.tags || [];
    return db.notes
      .filter(o => o.note_id !== note.note_id)
      .map(other => {
        let score = 0;
        const reasons = [];
        const otherTags = other.tags || [];
        if (note.category && other.category === note.category) { score += 5; reasons.push('同分类'); }
        if (note.subcategory && other.subcategory === note.subcategory) { score += 8; reasons.push('同小类'); }
        if (note.author_name && other.author_name === note.author_name) { score += 2; reasons.push('同作者'); }
        if (note.folder && other.folder === note.folder) { score += 4; reasons.push('同收藏夹'); }
        const shared = noteTags.filter(t => otherTags.includes(t));
        if (shared.length) { score += shared.length * 3; reasons.push('共享标签×' + shared.length); }
        return { other, score, reason: reasons.join(' · ') };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(x => ({ note: x.other, score: x.score, reason: x.reason }));
  }

  function getReview(q) {
    const n = Math.min(Number(q.get('n') || 8), 20);
    const app = q.get('app');
    const pool = db.notes.filter(x => !app || x.app === app);
    const total = pool.length;
    const reviewed = pool.filter(x => db.reviewed.has(x.note_id)).length;
    const unreviewed = total - reviewed;
    const pick = unreviewed > 0
      ? shuffle(pool.filter(x => !db.reviewed.has(x.note_id))).slice(0, n)
      : shuffle(pool).slice(0, n);
    return { total, reviewed, unreviewed, notes: pick };
  }

  function shim(u, opts) {
    const url = new URL(u, location.href);
    // 截取路径中 api/ 之后的部分（兼容根目录与 Pages 子目录两种部署）
    let p = url.pathname;
    const i = p.indexOf('api/');
    if (i === -1) return json({ error: 'not found' });
    p = p.slice(i);
    const q = url.searchParams;
    const json = x => new Response(JSON.stringify(x), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    if (p === 'api/stats') return json(D.stats);
    if (p === 'api/graph') return json(D.graph);
    if (p === 'api/info') return json({ port: 0, lanIps: [], urls: [], preview: true });
    if (p === 'api/categories') return json((D.categories[q.get('app') || ''] || []));
    if (p === 'api/tags') return json((D.tags[q.get('app') || ''] || []));
    if (p === 'api/notes') return json(listNotes(q));
    if (p.startsWith('api/notes/') && p.endsWith('/related')) {
      const id = decodeURIComponent(p.slice('api/notes/'.length, -'/related'.length));
      const note = db.notes.find(x => x.note_id === id);
      if (!note) return json({ error: 'not found' });
      return json({ note, related: getRelated(note) });
    }
    if (p.startsWith('api/notes/')) {
      const id = decodeURIComponent(p.slice('api/notes/'.length));
      const note = db.notes.find(x => x.note_id === id);
      return note ? json(note) : json({ error: 'not found' });
    }
    if (p === 'api/review' && (!opts || !opts.method || opts.method === 'GET')) return json(getReview(q));
    if (p === 'api/review/reset' && opts && opts.method === 'POST') { db.reviewed.clear(); return json({ ok: true }); }
    if (p.startsWith('api/review/') && opts && opts.method === 'POST') {
      db.reviewed.add(decodeURIComponent(p.slice('api/review/'.length)));
      return json({ ok: true });
    }
    if (p === 'api/export') {
      const f = q.get('format');
      const file = f === 'json' ? './personal-kb.json' : './personal-kb.md';
      return realFetch(new URL(file, location.href).href);
    }
    return json({ error: 'not found' });
  }

  window.fetch = function (u, opts) {
    if (typeof u === 'string' && u.indexOf('api/') !== -1) return Promise.resolve(shim(u, opts));
    return realFetch(u, opts);
  };

  // 静态预览没有局域网，隐藏「移动端访问」小组件
  window.addEventListener('DOMContentLoaded', () => {
    const w = document.getElementById('w-mobile');
    if (w) w.style.display = 'none';
  });
})();
`;

// ---------- 写文件 ----------
mkdirSync(outDir, { recursive: true });

const dataJson = JSON.stringify(DATA);
writeFileSync(path.join(outDir, 'data.js'),
  `window.KB_DATA = ${dataJson};\n` + SHIM, 'utf8');

// index.html：相对路径 + 注入 data.js
let html = readFileSync(path.join(webDir, 'index.html'), 'utf8');
html = html
  .replace(/href="\/style\.css"/g, 'href="./style.css"')
  .replace(/href="\/manifest\.json"/g, 'href="./manifest.json"')
  .replace(/href="\/icon\.svg"/g, 'href="./icon.svg"')
  .replace('src="/app.js"', 'src="./data.js"></script>\n  <script src="./app.js"');
writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');

// app.js：'/api/' → 'api/'（相对路径，Pages 子目录也能跑）
let appJs = readFileSync(path.join(webDir, 'app.js'), 'utf8');
appJs = appJs.replaceAll("'/api/", "'api/");
writeFileSync(path.join(outDir, 'app.js'), appJs, 'utf8');

for (const f of ['style.css', 'manifest.json', 'icon.svg']) {
  copyFileSync(path.join(webDir, f), path.join(outDir, f));
}

// 导出文件单独存放（懒加载，不进 data.js）
writeFileSync(path.join(outDir, 'personal-kb.md'), buildMarkdown(notes), 'utf8');
writeFileSync(path.join(outDir, 'personal-kb.json'), JSON.stringify({ total: notes.length, notes }, null, 2), 'utf8');

const sizeKb = Math.round(dataJson.length / 1024);
console.log(`✅ 静态预览已生成到 preview/`);
console.log(`   笔记 ${notes.length} 条 · 数据 ${sizeKb} KB · 生成时间 ${new Date().toISOString()}`);
console.log(`   推送到 gh-pages 分支后即可访问`);
