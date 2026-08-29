// 小红书 + 知乎 知识库前端
const state = {
  app: '',          // '' / 'xhs' / 'zhihu'
  category: '',     // '' / '__unclassified__' / 分类名
  subcategory: '',
  type: '',         // xhs: normal/video
  source: '',       // xhs: collect/liked
  folder: '',       // zhihu: 收藏夹名
  q: '',
  tag: '',
  sort: 'time',
};

const TYPE_LABEL = { normal: '图文', video: '视频', answer: '回答', article: '文章', zvideo: '视频', pin: '想法' };

function https(u) { return (u || '').replace(/^http:\/\//, 'https://'); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function tlInfo(score) {
  if (score == null) return null;
  if (score >= 8) return { label: '常青', cls: 'eval-evergreen' };
  if (score <= 4) return { label: '时效', cls: 'eval-timely' };
  return { label: '中性', cls: 'eval-neutral' };
}
function brInfo(score) {
  if (score == null) return null;
  if (score >= 8) return { label: '综述', cls: 'eval-broad' };
  if (score <= 4) return { label: '深挖', cls: 'eval-deep' };
  return { label: '适中', cls: 'eval-neutral' };
}
function evalBadges(n) {
  const tl = tlInfo(n.timeliness), br = brInfo(n.breadth);
  const parts = [];
  if (tl) parts.push(`<span class="eval-badge ${tl.cls}" title="时效性 ${n.timeliness}/10">${tl.label} ${n.timeliness}</span>`);
  if (br) parts.push(`<span class="eval-badge ${br.cls}" title="广度 ${n.breadth}/10">${br.label} ${n.breadth}</span>`);
  return parts.length ? `<span class="eval-tags">${parts.join('')}</span>` : '';
}
async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error('API ' + r.status);
  return r.json();
}

function buildQuery() {
  const p = new URLSearchParams();
  if (state.app) p.set('app', state.app);
  if (state.category === '__unclassified__') p.set('unclassified', '1');
  else if (state.category) p.set('category', state.category);
  if (state.subcategory) p.set('subcategory', state.subcategory);
  if (state.type) p.set('type', state.type);
  if (state.source) p.set('source', state.source);
  if (state.folder) p.set('folder', state.folder);
  if (state.q) p.set('q', state.q);
  if (state.tag) p.set('tag', state.tag);
  if (state.sort === 'liked') p.set('sort', 'liked');
  p.set('limit', '200');
  return p.toString();
}

// ---------- 统计与侧栏 ----------
async function loadSidebar() {
  const stats = await api('/api/stats');
  const cats = await api('/api/categories' + (state.app ? '?app=' + state.app : ''));
  const unclassified = stats.total - stats.classified;

  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="num">${stats.total}</div><div class="label">总笔记</div></div>
    <div class="stat"><div class="num">${stats.apps?.xhs ?? 0}</div><div class="label">小红书</div></div>
    <div class="stat"><div class="num">${stats.apps?.zhihu ?? 0}</div><div class="label">知乎</div></div>
    <div class="stat"><div class="num">${stats.classified}</div><div class="label">已分类</div></div>
  `;

  // 平台
  document.getElementById('app-list').innerHTML = [
    ['', '全部'],
    ['xhs', '小红书'],
    ['zhihu', '知乎'],
  ].map(([v, label]) => {
    const c = v === 'xhs' ? (stats.apps?.xhs ?? 0) : v === 'zhihu' ? (stats.apps?.zhihu ?? 0) : stats.total;
    return `<li data-app="${v}" class="${state.app === v ? 'active' : ''}"><span>${label}</span><span class="count">${c}</span></li>`;
  }).join('');

  // 分类
  document.getElementById('cat-list').innerHTML = [
    `<li data-cat="" class="${state.category === '' ? 'active' : ''}"><span>全部</span><span class="count">${state.app ? cats.reduce((a, c) => a + c.c, 0) : stats.total}</span></li>`,
    ...cats.map(c => `<li data-cat="${esc(c.category)}" class="${state.category === c.category ? 'active' : ''}"><span>${esc(c.category)}</span><span class="count">${c.c}</span></li>`),
    unclassified > 0 ? `<li data-cat="__unclassified__" class="${state.category === '__unclassified__' ? 'active' : ''}"><span>未分类</span><span class="count">${unclassified}</span></li>` : '',
  ].join('');

  // 类型 / 来源 / 文件夹 按平台显示
  const isZhihu = state.app === 'zhihu';
  const isXhs = state.app === 'xhs';
  const isAll = state.app === '';

  document.getElementById('type-block').hidden = !(isXhs || isAll);
  document.getElementById('source-block').hidden = !(isXhs || isAll);
  document.getElementById('folder-block').hidden = !(isXhs || isZhihu);

  document.getElementById('type-list').innerHTML = [
    ['', '全部'],
    ['normal', '图文'],
    ['video', '视频'],
  ].map(([v, label]) => `<li data-type="${v}" class="${state.type === v ? 'active' : ''}"><span>${label}</span><span class="count">${v ? (stats.types[v] || 0) : (state.app ? (stats.apps?.[state.app] ?? 0) : stats.total)}</span></li>`).join('');

  document.getElementById('source-list').innerHTML = [
    ['', '全部'],
    ['collect', '收藏'],
    ['liked', '点赞'],
  ].map(([v, label]) => {
    const c = v === 'collect' ? (stats.collected ?? 0) : v === 'liked' ? (stats.liked ?? 0) : stats.total;
    return `<li data-source="${v}" class="${state.source === v ? 'active' : ''}"><span>${label}</span><span class="count">${c}</span></li>`;
  }).join('');

  const appFolders = (stats.folders || []).filter(f => !state.app || f.app === state.app);
  const appTotal = state.app ? (stats.apps?.[state.app] ?? 0) : stats.total;
  document.getElementById('folder-list').innerHTML = [
    `<li data-folder="" class="${state.folder === '' ? 'active' : ''}"><span>全部</span><span class="count">${appTotal}</span></li>`,
    ...appFolders.map(f => `<li data-folder="${esc(f.folder)}" class="${state.folder === f.folder ? 'active' : ''}"><span>${esc(f.folder)}</span><span class="count">${f.c}</span></li>`),
  ].join('');
}

// ---------- 笔记网格 ----------
async function loadNotes() {
  let data;
  try {
    data = await api('/api/notes?' + buildQuery());
  } catch (e) {
    document.getElementById('grid').innerHTML = '';
    document.getElementById('empty').hidden = false;
    document.getElementById('empty').textContent = '加载失败：' + e.message;
    return;
  }

  const parts = [`共 <b>${data.total}</b> 条`];
  if (state.app) parts.push(state.app === 'xhs' ? '小红书' : '知乎');
  if (state.category === '__unclassified__') parts.push('未分类');
  else if (state.category) parts.push(`分类「${state.category}」`);
  if (state.folder) parts.push(`收藏夹「${state.folder}」`);
  if (state.type) parts.push(TYPE_LABEL[state.type] || state.type);
  if (state.source) parts.push(state.source === 'collect' ? '收藏' : '点赞');
  if (state.q) parts.push(`搜索「${state.q}」`);
  if (state.tag) parts.push(`标签「${state.tag}」`);
  if (state.sort === 'liked') parts.push('按点赞排序');
  document.getElementById('toolbar-count').innerHTML = parts.join(' · ');

  const bar = document.getElementById('filter-bar');
  const chips = [];
  if (state.subcategory) chips.push(`<span class="chip">小类「${esc(state.subcategory)}」<button data-clear="subcategory">✕</button></span>`);
  if (state.tag) chips.push(`<span class="chip">标签「${esc(state.tag)}」<button data-clear="tag">✕</button></span>`);
  if (chips.length) { bar.hidden = false; bar.innerHTML = chips.join(''); }
  else { bar.hidden = true; bar.innerHTML = ''; }

  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  document.getElementById('empty').hidden = data.notes.length > 0;
  for (const n of data.notes) grid.appendChild(renderCard(n));
}

function renderCard(n) {
  return n.app === 'zhihu' ? renderZhihuCard(n) : renderXhsCard(n);
}

function renderXhsCard(n) {
  const el = document.createElement('div');
  el.className = 'card';
  const typeLabel = TYPE_LABEL[n.type] || n.type;
  const catBadge = n.category ? `<span class="cat-badge">${esc(n.category)}</span>` : '';
  el.innerHTML = `
    <div class="thumb" style="background-image:url('${https(n.cover_url)}')">
      <span class="badge">${typeLabel}</span>${catBadge}
    </div>
    <div class="body">
      <div class="title">${esc(n.title)}</div>
      ${n.subcategory ? `<div class="subtag">${esc(n.subcategory)}</div>` : ''}
      <div class="meta">
        <img src="${https(n.author_avatar)}" onerror="this.style.display='none'" alt="" />
        <span class="name">${esc(n.author_name)}</span>
        ${n.folder ? `<span class="folder-chip">${esc(n.folder)}</span>` : ''}
        <span>${esc(n.liked_count)}</span>
      </div>
      ${evalBadges(n)}
    </div>
  `;
  el.addEventListener('click', () => openDetail(n.note_id));
  const subtag = el.querySelector('.subtag');
  if (subtag) subtag.addEventListener('click', e => { e.stopPropagation(); state.subcategory = n.subcategory; state.category = ''; loadSidebar(); loadNotes(); });
  return el;
}

function renderZhihuCard(n) {
  const el = document.createElement('div');
  el.className = 'card card-text';
  const typeLabel = TYPE_LABEL[n.type] || n.type || '';
  el.innerHTML = `
    <div class="body">
      <div class="zh-tags">
        <span class="type-tag">${typeLabel}</span>
        ${n.folder ? `<span class="folder-chip">${esc(n.folder)}</span>` : ''}
        ${n.category ? `<span class="cat-tag">${esc(n.category)}</span>` : ''}
      </div>
      <div class="title">${esc(n.title)}</div>
      ${n.subcategory ? `<div class="subtag">${esc(n.subcategory)}</div>` : ''}
      ${n.desc ? `<div class="excerpt">${esc(String(n.desc).slice(0, 140))}</div>` : ''}
      <div class="meta"><span class="name">${esc(n.author_name)}</span></div>
      ${evalBadges(n)}
    </div>
  `;
  el.addEventListener('click', () => openDetail(n.note_id));
  const subtag = el.querySelector('.subtag');
  if (subtag) subtag.addEventListener('click', e => { e.stopPropagation(); state.subcategory = n.subcategory; state.category = ''; loadSidebar(); loadNotes(); });
  return el;
}

// ---------- 详情 ----------
async function openDetail(id) {
  const n = await api('/api/notes/' + encodeURIComponent(id));
  let related = [];
  try { related = (await api('/api/notes/' + encodeURIComponent(id) + '/related')).related || []; } catch {}
  const isZhihu = n.app === 'zhihu';
  const tags = (n.tags || []).map(t => `<span class="tag tag-click" data-tag="${esc(t)}">${esc(t)}</span>`).join('');
  const typeLabel = TYPE_LABEL[n.type] || n.type || '';

  document.getElementById('detail-card').innerHTML = `
    <button class="close" onclick="document.getElementById('detail').hidden=true">✕</button>
    <h2>${esc(n.title)}</h2>
    <div class="author-row">
      <span class="n">${esc(n.author_name)}</span>
      ${n.folder ? `<span class="folder-chip">${esc(n.folder)}</span>` : ''}
    </div>
    <div class="info">
      ${isZhihu ? `平台：知乎 · 类型：${typeLabel}` : `平台：小红书 · 类型：${typeLabel} · 点赞 ${esc(n.liked_count)}`}
    </div>
    ${evalBadges(n)}
    ${n.category ? `<div class="tags"><span class="tag" style="background:var(--red);color:#fff">${esc(n.category)}</span>${n.subcategory ? `<span class="tag tag-click" data-sub="${esc(n.subcategory)}">${esc(n.subcategory)}</span>` : ''}${tags}</div>` : ''}
    ${n.summary ? `<div class="summary">${esc(n.summary)}</div>` : ''}
    ${isZhihu && n.desc ? `<div class="zhihu-desc">${esc(n.desc)}</div>` : ''}
    ${!isZhihu && n.cover_url ? `<img class="cover" src="${https(n.cover_url)}" onerror="this.style.display='none'" alt="" />` : ''}
    ${related.length ? `
      <div class="related">
        <div class="related-title">相关笔记（${related.length}）</div>
        ${related.map(r => `
          <div class="related-item" data-relid="${esc(r.note.note_id)}">
            <div class="related-note-title">${esc(r.note.title)}</div>
            <div class="related-reason">${esc(r.reason)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}
    <a class="open-link" href="${esc(n.note_url)}" target="_blank" rel="noopener">打开原文 ↗</a>
    <button class="graph-note-btn" data-graph="${esc(n.note_id)}">🕸️ 查看关系图谱</button>
  `;
  document.getElementById('detail').hidden = false;
}

// ---------- 事件 ----------
document.getElementById('app-list').addEventListener('click', e => {
  const li = e.target.closest('li[data-app]');
  if (!li) return;
  state.app = li.dataset.app;
  state.category = ''; state.subcategory = ''; state.type = ''; state.source = ''; state.folder = '';
  loadSidebar();
  loadNotes();
});

document.getElementById('cat-list').addEventListener('click', e => {
  const li = e.target.closest('li[data-cat]');
  if (!li) return;
  state.category = li.dataset.cat;
  state.subcategory = '';
  loadSidebar();
  loadNotes();
});

document.getElementById('type-list').addEventListener('click', e => {
  const li = e.target.closest('li[data-type]');
  if (!li) return;
  state.type = li.dataset.type;
  loadSidebar();
  loadNotes();
});

document.getElementById('source-list').addEventListener('click', e => {
  const li = e.target.closest('li[data-source]');
  if (!li) return;
  state.source = li.dataset.source;
  loadSidebar();
  loadNotes();
});

document.getElementById('folder-list').addEventListener('click', e => {
  const li = e.target.closest('li[data-folder]');
  if (!li) return;
  state.folder = li.dataset.folder;
  loadSidebar();
  loadNotes();
});

document.getElementById('sort').addEventListener('change', e => { state.sort = e.target.value; loadNotes(); });
async function downloadExport(format) {
  const r = await fetch('/api/export?format=' + format);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = format === 'json' ? 'personal-kb.json' : 'personal-kb.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
document.getElementById('export-md').addEventListener('click', () => downloadExport('md'));
document.getElementById('export-json').addEventListener('click', () => downloadExport('json'));

document.getElementById('filter-bar').addEventListener('click', e => {
  if (e.target.dataset.clear === 'subcategory') { state.subcategory = ''; loadNotes(); }
  else if (e.target.dataset.clear === 'tag') { state.tag = ''; loadNotes(); }
});

let searchTimer;
document.getElementById('search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); loadNotes(); }, 250);
});

document.getElementById('detail').addEventListener('click', e => { if (e.target.id === 'detail') e.target.hidden = true; });
document.getElementById('detail-card').addEventListener('click', e => {
  const gbtn = e.target.closest('.graph-note-btn');
  if (gbtn) { document.getElementById('detail').hidden = true; showNoteGraph(gbtn.dataset.graph); return; }
  const rel = e.target.closest('.related-item');
  if (rel) { openDetail(rel.dataset.relid); return; }
  const tag = e.target.closest('.tag-click');
  if (!tag) return;
  document.getElementById('detail').hidden = true;
  if (tag.dataset.sub) { state.subcategory = tag.dataset.sub; state.category = ''; }
  else if (tag.dataset.tag) { state.q = tag.dataset.tag; document.getElementById('search').value = tag.dataset.tag; }
  loadSidebar();
  loadNotes();
});

// ---------- 视图切换 ----------
let view = 'browse'; // 'browse' | 'dashboard' | 'graph' | 'review' | 'tags' | 'settings'

function setView(v) {
  view = v;
  document.getElementById('layout').hidden = (v !== 'browse');
  document.getElementById('dashboard').hidden = (v !== 'dashboard');
  document.getElementById('graph-view').hidden = (v !== 'graph');
  document.getElementById('review-view').hidden = (v !== 'review');
  document.getElementById('tags-view').hidden = (v !== 'tags');
  document.getElementById('settings-view').hidden = (v !== 'settings');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'dashboard') loadDashboard();
  if (v === 'review') loadReview();
  if (v === 'tags') loadTags();
  if (v === 'settings') loadSettings();
}

function showBrowse() { setView('browse'); }
function showDashboard() { setView('dashboard'); }

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const v = btn.dataset.view;
    if (v === 'graph') showCategoryGraph();
    else setView(v);
  });
});
document.getElementById('graph-cat-btn').addEventListener('click', showCategoryGraph);

// ---------- 图谱 ----------
const NS = 'http://www.w3.org/2000/svg';

function svgPoint(svg, e) {
  const rect = svg.getBoundingClientRect();
  const w = svg.viewBox.baseVal.width || rect.width;
  const h = svg.viewBox.baseVal.height || rect.height;
  return {
    x: (e.clientX - rect.left) * (w / rect.width),
    y: (e.clientY - rect.top) * (h / rect.height),
  };
}

function forceLayout(nodes, edges, width, height) {
  const pos = {};
  const radii = {};
  for (const n of nodes) {
    const r = n.r || 12;
    radii[n.id] = r + 26; // 节点半径 + 标签留白
    pos[n.id] = {
      x: width / 2 + (Math.random() - 0.5) * width * 0.5,
      y: height / 2 + (Math.random() - 0.5) * height * 0.5,
    };
  }
  const REPULSION = 3000, SPRING_K = 0.08, REST = 200;
  for (let it = 0; it < 400; it++) {
    const alpha = 1 - it / 400; // 逐渐降温，稳定收敛
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const idA = nodes[i].id, idB = nodes[j].id;
        const a = pos[idA], b = pos[idB];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const minD = radii[idA] + radii[idB];
        if (d < minD) {
          // 碰撞：推开到不重叠
          const push = (minD - d) * 0.5;
          a.x -= dx / d * push; a.y -= dy / d * push;
          b.x += dx / d * push; b.y += dy / d * push;
        } else {
          const f = Math.min(REPULSION / (d * d), 12) * alpha;
          a.x -= dx / d * f; a.y -= dy / d * f;
          b.x += dx / d * f; b.y += dy / d * f;
        }
      }
    }
    for (const e of edges) {
      const a = pos[e.source], b = pos[e.target];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = SPRING_K * (d - REST) * alpha;
      a.x += dx / d * f; a.y += dy / d * f;
      b.x -= dx / d * f; b.y -= dy / d * f;
    }
    for (const n of nodes) {
      const p = pos[n.id];
      p.x += (width / 2 - p.x) * 0.01;
      p.y += (height / 2 - p.y) * 0.01;
      // 边界约束
      p.x = Math.max(radii[n.id], Math.min(width - radii[n.id], p.x));
      p.y = Math.max(radii[n.id], Math.min(height - radii[n.id], p.y));
    }
  }
  return pos;
}

// 分类配色（稳定的分类色板）
const PALETTE = [
  '#2a78d6', '#eb6834', '#1baf7a', '#e6a700', '#e87ba4', '#7cb342', '#4a3aa7', '#e34948',
  '#0e9aa7', '#c66a00', '#9ccc65', '#8d6e63', '#5c6bc0', '#26a69a', '#ef5350', '#ab47bc',
  '#78909c', '#d4a017', '#00838f', '#6d4c41', '#00897b', '#f06292', '#455a64', '#7e57c2',
];

let graphMode = 'category'; // 'category' | 'note'

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function showCategoryGraph() {
  graphMode = 'category';
  document.getElementById('graph-cat-btn').hidden = true;
  document.getElementById('graph-hint').textContent = '分类图谱 · 节点大小=数量 · 连线=共享标签 · 拖动节点 · 悬停连线看共享标签 · 点击跳转分类';
  setView('graph');
  loadGraph();
}

function showNoteGraph(id) {
  graphMode = 'note';
  document.getElementById('graph-cat-btn').hidden = false;
  document.getElementById('graph-hint').textContent = '笔记关系图谱 · 中心=当前笔记 · 连线=相关原因 · 点击节点看详情';
  setView('graph');
  loadNoteGraph(id);
}

async function loadGraph() {
  const g = await api('/api/graph');
  const nodes = (g.nodes || []).map((n, i) => ({
    id: n.id,
    label: n.id,
    r: 10 + Math.sqrt(n.count) * 1.6,
    color: PALETTE[i % PALETTE.length],
    text: n.count,
    title: `${n.id} · ${n.count} 条`,
    onClick: () => { state.category = n.id; state.subcategory = ''; setView('browse'); loadSidebar(); loadNotes(); },
  }));
  const edges = (g.edges || []).map(e => ({
    source: e.source,
    target: e.target,
    width: Math.min(0.5 + e.weight * 0.4, 5),
    title: `${e.source} ⟷ ${e.target}：共享标签 ${e.weight} 个${e.tags && e.tags.length ? '（' + e.tags.join('、') + ' 等）' : ''}`,
  }));
  renderGraph(nodes, edges);
}

async function loadNoteGraph(id) {
  let d;
  try { d = await api('/api/notes/' + encodeURIComponent(id) + '/related'); }
  catch { d = { note: null, related: [] }; }
  const center = d.note, related = d.related || [];
  if (!center) return;
  const nodes = [
    { id: center.note_id, label: truncate(center.title, 16), r: 26, color: '#ff2442', text: '', title: center.title, onClick: () => openDetail(center.note_id) },
    ...related.map(r => ({
      id: r.note.note_id,
      label: truncate(r.note.title, 14),
      r: 13 + Math.min(r.score, 15) * 0.7,
      color: r.note.app === 'zhihu' ? '#0066ff' : '#2a78d6',
      text: r.score,
      title: `${r.reason}（${r.score}分）\n${r.note.title}`,
      onClick: () => openDetail(r.note.note_id),
    })),
  ];
  const edges = related.map(r => ({
    source: center.note_id,
    target: r.note.note_id,
    width: Math.min(1 + r.score * 0.3, 4),
    title: `${r.reason}（${r.score}分）`,
  }));
  renderGraph(nodes, edges);
}

// ---------- 图谱交互状态 ----------
let graphLayer = null;
let graphZoom = { x: 0, y: 0, k: 1 };
let graphPos = {};
let graphAdj = {};
let graphEdgeEls = {};
const graphDrag = { active: false, id: null, g: null, moved: false };
const graphPan = { active: false, sx: 0, sy: 0 };

function applyGraphZoom() {
  if (graphLayer) graphLayer.setAttribute('transform', `translate(${graphZoom.x},${graphZoom.y}) scale(${graphZoom.k})`);
}
function zoomGraphBy(f) {
  graphZoom.k = Math.max(0.2, Math.min(5, graphZoom.k * f));
  applyGraphZoom();
}
function resetGraphZoom() {
  graphZoom = { x: 0, y: 0, k: 1 };
  applyGraphZoom();
}

function renderGraph(nodes, edges) {
  const svg = document.getElementById('graph-svg');
  const W = 1000, H = 640;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.innerHTML = '';

  graphZoom = { x: 0, y: 0, k: 1 };
  graphDrag.active = false; graphDrag.id = null; graphDrag.g = null; graphDrag.moved = false;
  graphPan.active = false;

  const layer = document.createElementNS(NS, 'g');
  graphLayer = layer;
  svg.appendChild(layer);

  graphPos = forceLayout(nodes, edges, W, H);
  graphAdj = {};
  graphEdgeEls = {};

  const edgeKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  for (const e of edges) {
    const a = graphPos[e.source], b = graphPos[e.target];
    if (!a || !b) continue;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    line.setAttribute('stroke', '#c3cdd9');
    line.setAttribute('stroke-width', e.width != null ? e.width : 1);
    line.setAttribute('opacity', 0.75);
    if (e.title) { const t = document.createElementNS(NS, 'title'); t.textContent = e.title; line.appendChild(t); }
    layer.appendChild(line);
    const key = edgeKey(e.source, e.target);
    graphEdgeEls[key] = { line, a: e.source, b: e.target };
    (graphAdj[e.source] = graphAdj[e.source] || []).push({ other: e.target, key });
    (graphAdj[e.target] = graphAdj[e.target] || []).push({ other: e.source, key });
  }

  for (const n of nodes) {
    const p = graphPos[n.id];
    const r = n.r || 12;
    const color = n.color || '#2a78d6';
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'graph-node');
    g.setAttribute('transform', `translate(${p.x},${p.y})`);
    g.style.cursor = 'grab';
    if (n.title) { const t = document.createElementNS(NS, 'title'); t.textContent = n.title; g.appendChild(t); }

    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('r', r);
    circle.setAttribute('fill', color);
    circle.setAttribute('fill-opacity', 0.85);
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', 2);
    g.appendChild(circle);

    if (n.text != null && n.text !== '') {
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('text-anchor', 'middle'); text.setAttribute('dy', 4);
      text.setAttribute('font-size', r > 16 ? 11 : 9);
      text.setAttribute('fill', '#fff'); text.setAttribute('font-weight', '700');
      text.textContent = n.text;
      g.appendChild(text);
    }

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('text-anchor', 'middle'); label.setAttribute('y', r + 14);
    label.setAttribute('font-size', 12); label.setAttribute('fill', '#333'); label.setAttribute('font-weight', '600');
    label.textContent = n.label;
    g.appendChild(label);

    g.addEventListener('mousedown', e => {
      graphDrag.active = true; graphDrag.id = n.id; graphDrag.g = g; graphDrag.moved = false;
      g.style.cursor = 'grabbing';
      e.stopPropagation();
    });
    g.addEventListener('click', () => {
      if (graphDrag.moved) { graphDrag.moved = false; return; }
      if (n.onClick) n.onClick();
    });
    layer.appendChild(g);
  }
}

// ---------- 图谱交互（只绑定一次）----------
(function initGraphInteractions() {
  const svg = document.getElementById('graph-svg');
  if (!svg) return;

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const c = svgPoint(svg, e);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const k2 = Math.max(0.2, Math.min(5, graphZoom.k * factor));
    graphZoom.x = c.x - (c.x - graphZoom.x) / graphZoom.k * k2;
    graphZoom.y = c.y - (c.y - graphZoom.y) / graphZoom.k * k2;
    graphZoom.k = k2;
    applyGraphZoom();
  }, { passive: false });

  svg.addEventListener('mousedown', e => {
    if (e.target === svg) { graphPan.active = true; graphPan.sx = e.clientX; graphPan.sy = e.clientY; }
  });

  svg.addEventListener('mousemove', e => {
    if (graphDrag.active) {
      const c = svgPoint(svg, e);
      const lx = (c.x - graphZoom.x) / graphZoom.k;
      const ly = (c.y - graphZoom.y) / graphZoom.k;
      const p = graphPos[graphDrag.id];
      if (p) { p.x = lx; p.y = ly; }
      graphDrag.moved = true;
      graphDrag.g.setAttribute('transform', `translate(${lx},${ly})`);
      for (const { other, key } of graphAdj[graphDrag.id] || []) {
        const el = graphEdgeEls[key];
        if (!el) continue;
        if (el.a === graphDrag.id) { el.line.setAttribute('x1', lx); el.line.setAttribute('y1', ly); }
        else { el.line.setAttribute('x2', lx); el.line.setAttribute('y2', ly); }
      }
    } else if (graphPan.active) {
      const rect = svg.getBoundingClientRect();
      const vbW = svg.viewBox.baseVal.width, vbH = svg.viewBox.baseVal.height;
      graphZoom.x += (e.clientX - graphPan.sx) * (vbW / rect.width);
      graphZoom.y += (e.clientY - graphPan.sy) * (vbH / rect.height);
      graphPan.sx = e.clientX; graphPan.sy = e.clientY;
      applyGraphZoom();
    }
  });

  window.addEventListener('mouseup', () => {
    if (graphDrag.g) graphDrag.g.style.cursor = 'grab';
    graphDrag.active = false;
    graphPan.active = false;
  });

  document.getElementById('graph-zoom-in').addEventListener('click', () => zoomGraphBy(1.3));
  document.getElementById('graph-zoom-out').addEventListener('click', () => zoomGraphBy(1 / 1.3));
  document.getElementById('graph-zoom-reset').addEventListener('click', resetGraphZoom);
})();

function barsHtml(list, kind) {
  const max = list[0]?.c || 1;
  return list.map(item => {
    const label = kind === 'sub' ? `${item.category}·${item.subcategory}` : item.category;
    const attrs = kind === 'sub'
      ? `data-cat="${esc(item.category)}" data-sub="${esc(item.subcategory)}"`
      : `data-cat="${esc(item.category)}"`;
    return `
      <div class="hbar-row" ${attrs}>
        <span class="hbar-label">${esc(label)}</span>
        <div class="hbar-track"><div class="hbar-fill" style="width:${(item.c / max * 100).toFixed(1)}%"></div></div>
        <span class="hbar-val">${item.c}</span>
      </div>
    `;
  }).join('');
}

async function loadDashboard() {
  const stats = await api('/api/stats');
  const review = await api('/api/review?n=8');
  const info = await api('/api/info');

  // 总笔记
  document.getElementById('w-total').innerHTML = `
    <div class="widget-label">总笔记</div>
    <div class="widget-value">${stats.total}</div>
    <div class="widget-sub">小红书 ${stats.apps?.xhs ?? 0} · 知乎 ${stats.apps?.zhihu ?? 0}</div>
  `;

  // 已分类
  const clsPct = stats.total ? Math.round(stats.classified / stats.total * 100) : 0;
  document.getElementById('w-classified').innerHTML = `
    <div class="widget-label">已分类</div>
    <div class="widget-value">${stats.classified}</div>
    <div class="widget-sub">覆盖率 ${clsPct}%</div>
  `;

  // 回顾进度环
  const ringPct = review.total ? Math.round(review.reviewed / review.total * 100) : 0;
  const C = 2 * Math.PI * 50;
  document.getElementById('w-ring').innerHTML = `
    <div class="widget-label">回顾进度</div>
    <div class="ring-wrap">
      <svg viewBox="0 0 120 120">
        <circle class="ring-bg" cx="60" cy="60" r="50"></circle>
        <circle class="ring-fg" cx="60" cy="60" r="50" stroke-dasharray="${(C * ringPct / 100).toFixed(1)} ${C.toFixed(1)}"></circle>
      </svg>
      <div class="ring-center"><span class="pct">${ringPct}%</span><span class="lbl">已回顾</span></div>
    </div>
    <div class="widget-sub">${review.reviewed} / ${review.total} · 剩 ${review.unreviewed}</div>
  `;

  // 平台分布
  const xhs = stats.apps?.xhs ?? 0;
  const zhihu = stats.apps?.zhihu ?? 0;
  const total = xhs + zhihu || 1;
  const xhsPct = (xhs / total * 100).toFixed(1);
  document.getElementById('w-platform').innerHTML = `
    <div class="widget-label">平台分布</div>
    <div class="stacked">
      <div class="stack-seg" style="width:${xhsPct}%;background:#2a78d6">小红书 ${xhs}</div>
      <div class="stack-seg" style="width:${(100 - Number(xhsPct)).toFixed(1)}%;background:#eb6834">知乎 ${zhihu}</div>
    </div>
    <div class="legend">
      <span class="legend-item"><span class="dot" style="background:#2a78d6"></span>小红书 ${xhs}</span>
      <span class="legend-item"><span class="dot" style="background:#eb6834"></span>知乎 ${zhihu}</span>
    </div>
    <div class="widget-sub">图文 ${stats.types.normal || 0} · 视频 ${stats.types.video || 0} · 回答 ${stats.types.answer || 0} · 文章 ${stats.types.article || 0}</div>
  `;

  // 分类 Top 8
  document.getElementById('w-categories').innerHTML = `
    <div class="widget-label">分类 Top 8</div>
    ${barsHtml((stats.categories || []).slice(0, 8), 'cat')}
  `;

  // 小类 Top 8
  document.getElementById('w-subcats').innerHTML = `
    <div class="widget-label">小类 Top 8</div>
    ${barsHtml((stats.subcategories || []).slice(0, 8), 'sub')}
  `;

  // 常看的作者
  document.getElementById('w-authors').innerHTML = `
    <div class="widget-label">常看的作者</div>
    ${(stats.authors || []).map(a => `
      <div class="author-row">
        <span class="author-name">${esc(a.author_name)}</span>
        <span class="author-count">${a.c}</span>
      </div>
    `).join('')}
  `;

  // 今日回顾
  document.getElementById('w-review').innerHTML = `
    <div class="widget-label" style="display:flex;align-items:center">
      今日回顾
      <span class="review-progress">已回顾 ${review.reviewed} / ${review.total}</span>
      <button id="review-reset" class="mini-btn">重新开始一轮</button>
    </div>
    <div class="review-grid">
      ${review.notes.map(n => `
        <div class="review-card" data-id="${esc(n.note_id)}">
          <div class="review-app">${n.app === 'zhihu' ? '知乎' : '小红书'}</div>
          <div class="review-title">${esc(n.title)}</div>
          ${n.summary ? `<div class="review-summary">${esc(n.summary)}</div>` : ''}
          <div class="review-actions">
            <a href="${esc(n.note_url)}" target="_blank" rel="noopener">打开 ↗</a>
            <button class="review-done">标记已回顾</button>
          </div>
        </div>
      `).join('')}
    </div>
    ${review.unreviewed === 0 ? '<div class="review-empty">🎉 全部回顾完了！点「重新开始一轮」进入下一轮。</div>' : ''}
  `;

  // 移动端访问
  const urls = info.urls || [];
  document.getElementById('w-mobile').innerHTML = `
    <div class="widget-label">移动端访问</div>
    <div class="mobile-box">
      ${urls.length ? urls.map(u => `
        <div class="mobile-item">
          <span class="mobile-addr">${esc(u)}</span>
          <img class="mobile-qr" src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(u)}" alt="二维码" onerror="this.style.display='none'" />
        </div>
      `).join('') : '<span class="mobile-addr">未检测到局域网地址（请检查网络连接）</span>'}
    </div>
    <div class="widget-sub">手机连同一 Wi-Fi → 扫码或输入地址 → 浏览器菜单「添加到主屏幕」，桌面就有 APP 图标，点开即用（无需每次输网址）</div>
  `;

  document.getElementById('review-reset').addEventListener('click', async () => {
    await fetch('/api/review/reset', { method: 'POST' });
    loadDashboard();
  });
  document.querySelectorAll('#w-review .review-done').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.target.closest('.review-card').dataset.id;
      await fetch('/api/review/' + encodeURIComponent(id), { method: 'POST' });
      loadDashboard();
    });
  });
  document.querySelectorAll('#w-categories [data-cat]').forEach(el => {
    el.addEventListener('click', () => { state.category = el.dataset.cat; state.subcategory = ''; showBrowse(); loadSidebar(); loadNotes(); });
  });
  document.querySelectorAll('#w-subcats [data-sub]').forEach(el => {
    el.addEventListener('click', () => { state.category = el.dataset.cat; state.subcategory = el.dataset.sub; showBrowse(); loadSidebar(); loadNotes(); });
  });
}

// ---------- 回顾（防吃灰）----------
let reviewApp = '';
let reviewStats = { total: 0, reviewed: 0, unreviewed: 0 };
let reviewQueue = [];

async function loadReview() {
  const r = await api('/api/review?n=30' + (reviewApp ? '&app=' + reviewApp : ''));
  reviewStats = { total: r.total, reviewed: r.reviewed, unreviewed: r.unreviewed };
  reviewQueue = r.notes.slice();
  renderReview();
}

function renderReview() {
  const el = document.getElementById('review-view');
  const pct = reviewStats.total ? Math.round(reviewStats.reviewed / reviewStats.total * 100) : 0;

  let html = `
    <div class="review-head">
      <div>
        <div class="review-title">📖 回顾</div>
        <div class="review-count">已回顾 <b>${reviewStats.reviewed}</b> / ${reviewStats.total} · 剩 <b>${reviewStats.unreviewed}</b> 条未回顾</div>
      </div>
      <div class="review-controls">
        <select id="review-app-select">
          <option value="">全部平台</option>
          <option value="xhs" ${reviewApp === 'xhs' ? 'selected' : ''}>小红书</option>
          <option value="zhihu" ${reviewApp === 'zhihu' ? 'selected' : ''}>知乎</option>
        </select>
        <button class="btn" id="review-reset-btn">重新开始一轮</button>
      </div>
    </div>
    <div class="review-track"><div class="review-track-fill" style="width:${pct}%"></div></div>
  `;

  if (reviewQueue.length === 0) {
    html += `<div class="review-done-all"><div class="big">🎉</div>全部回顾完了！点「重新开始一轮」进入下一轮，或去「浏览」看别的。</div>`;
  } else {
    const n = reviewQueue[0];
    html += `
      <div class="review-current">
        <div class="rc-app">${n.app === 'zhihu' ? '知乎' : '小红书'} · ${TYPE_LABEL[n.type] || ''}</div>
        <div class="rc-title">${esc(n.title)}</div>
        <div class="rc-tags">
          ${n.category ? `<span class="cat-tag">${esc(n.category)}</span>` : ''}
          ${n.subcategory ? `<span class="tag" style="background:var(--red-soft);color:var(--red);font-size:12px;padding:4px 10px;border-radius:12px">${esc(n.subcategory)}</span>` : ''}
          ${(n.tags || []).map(t => `<span class="tag" style="background:var(--bg);color:var(--text-2);font-size:12px;padding:4px 10px;border-radius:12px">${esc(t)}</span>`).join('')}
        </div>
        ${n.summary ? `<div class="rc-summary">${esc(n.summary)}</div>` : ''}
        ${evalBadges(n)}
        <div class="rc-actions">
          <button class="rc-btn primary" id="review-done-btn">✓ 已回顾</button>
          <button class="rc-btn" id="review-skip-btn">跳过 →</button>
          <a class="rc-link" href="${esc(n.note_url)}" target="_blank" rel="noopener">打开原文 ↗</a>
          <span class="rc-hint">快捷键：← 跳过 · → / 空格 已回顾</span>
        </div>
      </div>
    `;

    if (reviewQueue.length > 1) {
      html += `<div class="review-queue"><div class="review-queue-title">接下来（${reviewQueue.length - 1} 条）</div>` +
        reviewQueue.slice(1, 8).map(m => `
          <div class="review-queue-item" data-id="${esc(m.note_id)}">
            <span class="q-app">${m.app === 'zhihu' ? '知乎' : '小红书'}</span>
            <span class="q-title">${esc(m.title)}</span>
          </div>
        `).join('') + `</div>`;
    }
  }

  el.innerHTML = html;

  const appSel = document.getElementById('review-app-select');
  if (appSel) appSel.addEventListener('change', e => { reviewApp = e.target.value; loadReview(); });
  const resetBtn = document.getElementById('review-reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', async () => { await fetch('/api/review/reset', { method: 'POST' }); loadReview(); });
  const doneBtn = document.getElementById('review-done-btn');
  if (doneBtn) doneBtn.addEventListener('click', () => reviewAdvance(true));
  const skipBtn = document.getElementById('review-skip-btn');
  if (skipBtn) skipBtn.addEventListener('click', () => reviewAdvance(false));
  document.querySelectorAll('.review-queue-item').forEach(it => {
    it.addEventListener('click', () => openDetail(it.dataset.id));
  });
}

async function reviewAdvance(mark) {
  const cur = reviewQueue[0];
  if (!cur) return;
  if (mark) {
    await fetch('/api/review/' + encodeURIComponent(cur.note_id), { method: 'POST' });
    reviewStats.reviewed++;
    reviewStats.unreviewed = Math.max(0, reviewStats.unreviewed - 1);
  }
  reviewQueue.shift();
  if (reviewQueue.length < 5) {
    try {
      const more = await api('/api/review?n=30' + (reviewApp ? '&app=' + reviewApp : ''));
      reviewStats = { total: more.total, reviewed: more.reviewed, unreviewed: more.unreviewed };
      const seen = new Set(reviewQueue.map(x => x.note_id));
      for (const m of more.notes) if (!seen.has(m.note_id)) reviewQueue.push(m);
    } catch {}
  }
  renderReview();
}

document.addEventListener('keydown', e => {
  if (view !== 'review' || reviewQueue.length === 0) return;
  const t = e.target.tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); reviewAdvance(true); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); reviewAdvance(false); }
});

// ---------- 标签云 ----------
async function loadTags() {
  const list = await api('/api/tags' + (state.app ? '?app=' + state.app : ''));
  const el = document.getElementById('tags-cloud');
  if (!list.length) {
    el.innerHTML = '<div class="tags-empty">暂无标签（先跑一次 <code>node server/classify.mjs</code> 生成标签）</div>';
    return;
  }
  const max = list[0].c || 1;
  el.innerHTML = list.slice(0, 150).map(t => {
    const size = 12 + Math.round((t.c / max) * 22);
    const weight = t.c > max * 0.5 ? 700 : (t.c > max * 0.2 ? 500 : 400);
    return `<span class="tag-cloud-item" data-tag="${esc(t.tag)}" style="font-size:${size}px;font-weight:${weight}">${esc(t.tag)}<span class="tc-count">${t.c}</span></span>`;
  }).join('');
  el.querySelectorAll('.tag-cloud-item').forEach(s => {
    s.addEventListener('click', () => {
      state.tag = s.dataset.tag;
      state.category = ''; state.subcategory = '';
      state.q = ''; document.getElementById('search').value = '';
      showBrowse(); loadSidebar(); loadNotes();
    });
  });
}

// ---------- 设置 / 数据 ----------
async function loadSettings() {
  const stats = await api('/api/stats');
  const review = await api('/api/review?n=1');
  const info = await api('/api/info');
  const unclassified = stats.total - stats.classified;

  const urls = (info.urls || []).map(u => `<div class="settings-addr">🔗 ${esc(u)}</div>`).join('') || '<div class="settings-addr">未检测到局域网地址</div>';

  document.getElementById('settings-view').innerHTML = `
    <div class="settings-card">
      <h3>📤 导出数据</h3>
      <p class="settings-desc">把整个知识库导出为 Markdown / JSON 文件（按分类整理，含标题、摘要、标签、原文链接）。</p>
      <div class="settings-row">
        <button class="btn" id="set-export-md">导出 Markdown</button>
        <button class="btn" id="set-export-json">导出 JSON</button>
      </div>
    </div>

    <div class="settings-card">
      <h3>📊 数据概览</h3>
      <p class="settings-desc">当前知识库的数据量。</p>
      <div class="settings-grid">
        <div class="settings-stat"><div class="n">${stats.total}</div><div class="l">总笔记</div></div>
        <div class="settings-stat"><div class="n">${stats.apps?.xhs ?? 0}</div><div class="l">小红书</div></div>
        <div class="settings-stat"><div class="n">${stats.apps?.zhihu ?? 0}</div><div class="l">知乎</div></div>
        <div class="settings-stat"><div class="n">${stats.classified}</div><div class="l">已分类</div></div>
        <div class="settings-stat"><div class="n">${unclassified}</div><div class="l">未分类</div></div>
        <div class="settings-stat"><div class="n">${review.reviewed}</div><div class="l">已回顾</div></div>
      </div>
    </div>

    <div class="settings-card">
      <h3>🔌 访问方式</h3>
      <p class="settings-desc">手机连同一 Wi-Fi，浏览器打开下面任一地址；再点浏览器菜单「添加到主屏幕」，桌面就有 APP 图标，点开即用。</p>
      ${urls}
    </div>

    <div class="settings-card">
      <h3>🔄 采集与更新</h3>
      <p class="settings-desc">数据来源与更新流程（详见 README 与脚本注释）。</p>
      <div class="settings-list">
        <b>① 采集</b>：Tampermonkey 安装 <code>collector.user.js</code>（小红书）和 <code>zhihu-collector.user.js</code>（知乎），在对应页面自动抓取收藏/点赞。<br/>
        <b>② 入库</b>：<code>node server/ingest.mjs 导出.json</code>（小红书）或 <code>node server/ingest-zhihu.mjs 导出.json</code>（知乎）。<br/>
        <b>③ 分类</b>：<code>node server/classify.mjs</code> 用 LLM 自动打分类 / 小类 / 标签 / 摘要。<br/>
        <b>④ 评价</b>：<code>node server/evaluate.mjs</code> 打时效性 + 广度分。<br/>
        <b>⑤ 启动</b>：<code>node server/server.mjs</code>，浏览器打开 <code>http://localhost:8787</code>。
      </div>
    </div>
  `;

  document.getElementById('set-export-md').addEventListener('click', () => downloadExport('md'));
  document.getElementById('set-export-json').addEventListener('click', () => downloadExport('json'));
}

// ---------- 启动 ----------
loadSidebar();
loadNotes();
