// 小红书 + 知乎 知识库前端
const state = {
  app: '',          // '' / 'xhs' / 'zhihu'
  category: '',     // '' / '__unclassified__' / 分类名
  subcategory: '',
  type: '',         // xhs: normal/video
  source: '',       // xhs: collect/liked
  folder: '',       // zhihu: 收藏夹名
  q: '',
  sort: 'time',
};

const TYPE_LABEL = { normal: '图文', video: '视频', answer: '回答', article: '文章', zvideo: '视频', pin: '想法' };

function https(u) { return (u || '').replace(/^http:\/\//, 'https://'); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  document.getElementById('folder-block').hidden = !(isZhihu);

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

  document.getElementById('folder-list').innerHTML = [
    `<li data-folder="" class="${state.folder === '' ? 'active' : ''}"><span>全部</span><span class="count">${stats.apps?.zhihu ?? 0}</span></li>`,
    ...(stats.folders || []).map(f => `<li data-folder="${esc(f.folder)}" class="${state.folder === f.folder ? 'active' : ''}"><span>${esc(f.folder)}</span><span class="count">${f.c}</span></li>`),
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
  if (state.sort === 'liked') parts.push('按点赞排序');
  document.getElementById('toolbar-count').innerHTML = parts.join(' · ');

  const bar = document.getElementById('filter-bar');
  if (state.subcategory) {
    bar.hidden = false;
    bar.innerHTML = `<span class="chip">小类「${esc(state.subcategory)}」<button data-clear="subcategory">✕</button></span>`;
  } else {
    bar.hidden = true;
    bar.innerHTML = '';
  }

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
        <span>${esc(n.liked_count)}</span>
      </div>
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
    ${n.category ? `<div class="tags"><span class="tag" style="background:var(--red);color:#fff">${esc(n.category)}</span>${n.subcategory ? `<span class="tag tag-click" data-sub="${esc(n.subcategory)}">${esc(n.subcategory)}</span>` : ''}${tags}</div>` : ''}
    ${n.summary ? `<div class="summary">${esc(n.summary)}</div>` : ''}
    ${isZhihu && n.desc ? `<div class="zhihu-desc">${esc(n.desc)}</div>` : ''}
    ${!isZhihu && n.cover_url ? `<img class="cover" src="${https(n.cover_url)}" onerror="this.style.display='none'" alt="" />` : ''}
    <a class="open-link" href="${esc(n.note_url)}" target="_blank" rel="noopener">打开原文 ↗</a>
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
document.getElementById('export-md').addEventListener('click', () => { window.location.href = '/api/export?format=md'; });
document.getElementById('export-json').addEventListener('click', () => { window.location.href = '/api/export?format=json'; });

document.getElementById('filter-bar').addEventListener('click', e => {
  if (e.target.dataset.clear === 'subcategory') { state.subcategory = ''; loadNotes(); }
});

let searchTimer;
document.getElementById('search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); loadNotes(); }, 250);
});

document.getElementById('detail').addEventListener('click', e => { if (e.target.id === 'detail') e.target.hidden = true; });
document.getElementById('detail-card').addEventListener('click', e => {
  const tag = e.target.closest('.tag-click');
  if (!tag) return;
  document.getElementById('detail').hidden = true;
  if (tag.dataset.sub) { state.subcategory = tag.dataset.sub; state.category = ''; }
  else if (tag.dataset.tag) { state.q = tag.dataset.tag; document.getElementById('search').value = tag.dataset.tag; }
  loadSidebar();
  loadNotes();
});

// ---------- 仪表盘 ----------
let view = 'browse'; // 'browse' | 'dashboard'

function showDashboard() {
  view = 'dashboard';
  document.getElementById('dashboard').hidden = false;
  document.getElementById('layout').hidden = true;
  document.getElementById('dash-btn').textContent = '📄 返回浏览';
  loadDashboard();
}

function showBrowse() {
  view = 'browse';
  document.getElementById('dashboard').hidden = true;
  document.getElementById('layout').hidden = false;
  document.getElementById('dash-btn').textContent = '📊 仪表盘';
}

document.getElementById('dash-btn').addEventListener('click', () => {
  if (view === 'dashboard') showBrowse(); else showDashboard();
});

async function loadDashboard() {
  const stats = await api('/api/stats');
  const review = await api('/api/review?n=8');

  // 平台分布（横向堆叠条）
  const xhs = stats.apps?.xhs ?? 0;
  const zhihu = stats.apps?.zhihu ?? 0;
  const total = xhs + zhihu || 1;
  const xhsPct = (xhs / total * 100).toFixed(1);
  document.getElementById('dash-platform').innerHTML = `
    <div class="dash-title">平台分布</div>
    <div class="stacked">
      <div class="stack-seg" style="width:${xhsPct}%;background:#2a78d6">小红书 ${xhs}</div>
      <div class="stack-seg" style="width:${(100 - Number(xhsPct)).toFixed(1)}%;background:#eb6834">知乎 ${zhihu}</div>
    </div>
    <div class="legend">
      <span class="legend-item"><span class="dot" style="background:#2a78d6"></span>小红书 ${xhs}</span>
      <span class="legend-item"><span class="dot" style="background:#eb6834"></span>知乎 ${zhihu}</span>
    </div>
  `;

  // 分类分布 Top 12（单一蓝色横条）
  const cats = (stats.categories || []).slice(0, 12);
  const maxCat = cats[0]?.c || 1;
  document.getElementById('dash-categories').innerHTML = `
    <div class="dash-title">分类分布 Top 12</div>
    ${cats.map(c => `
      <div class="hbar-row" data-cat="${esc(c.category)}">
        <span class="hbar-label">${esc(c.category)}</span>
        <div class="hbar-track"><div class="hbar-fill" style="width:${(c.c / maxCat * 100).toFixed(1)}%"></div></div>
        <span class="hbar-val">${c.c}</span>
      </div>
    `).join('')}
  `;

  // 小类 Top 10
  const subs = (stats.subcategories || []).slice(0, 10);
  const maxSub = subs[0]?.c || 1;
  document.getElementById('dash-subcats').innerHTML = `
    <div class="dash-title">小类 Top 10</div>
    ${subs.map(s => `
      <div class="hbar-row" data-cat="${esc(s.category)}" data-sub="${esc(s.subcategory)}">
        <span class="hbar-label">${esc(s.category)}·${esc(s.subcategory)}</span>
        <div class="hbar-track"><div class="hbar-fill" style="width:${(s.c / maxSub * 100).toFixed(1)}%"></div></div>
        <span class="hbar-val">${s.c}</span>
      </div>
    `).join('')}
  `;

  // 今日回顾
  document.getElementById('dash-review').innerHTML = `
    <div class="dash-title">
      今日回顾
      <span class="review-progress">已回顾 ${review.reviewed} / ${review.total}（剩余 ${review.unreviewed}）</span>
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

  document.getElementById('review-reset').addEventListener('click', async () => {
    await fetch('/api/review/reset', { method: 'POST' });
    loadDashboard();
  });
  document.querySelectorAll('#dash-review .review-done').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.target.closest('.review-card').dataset.id;
      await fetch('/api/review/' + encodeURIComponent(id), { method: 'POST' });
      loadDashboard();
    });
  });
  document.querySelectorAll('#dash-categories [data-cat]').forEach(el => {
    el.addEventListener('click', () => {
      state.category = el.dataset.cat; state.subcategory = '';
      showBrowse(); loadSidebar(); loadNotes();
    });
  });
  document.querySelectorAll('#dash-subcats [data-sub]').forEach(el => {
    el.addEventListener('click', () => {
      state.category = el.dataset.cat; state.subcategory = el.dataset.sub;
      showBrowse(); loadSidebar(); loadNotes();
    });
  });
}

// ---------- 启动 ----------
loadSidebar();
loadNotes();
