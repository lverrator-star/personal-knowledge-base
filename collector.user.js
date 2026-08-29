// ==UserScript==
// @name         小红书知识库采集器
// @namespace    local.xhs-kb
// @version      0.5
// @description  拦截小红书笔记列表接口（收藏/点赞），支持收藏夹子文件夹识别，自动滚动翻页，去重导出 JSON
// @match        https://www.xiaohongshu.com/*
// @match        https://edith.xiaohongshu.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'xhs_collector_v2';
  const seen = new Map();             // note_id -> normalized note
  const interceptedUrls = new Set();  // 命中的请求 URL
  const boards = new Map();           // 收藏夹 id -> name
  let running = false;

  function normalizeNote(n, source, folder) {
    const raw = (n && n.note && typeof n.note === 'object') ? n.note : n;
    if (!raw || !raw.note_id) return null;
    const cover = raw.cover || {};
    const coverUrls = [];
    if (Array.isArray(cover.info_list)) {
      for (const it of cover.info_list) if (it && it.url && !coverUrls.includes(it.url)) coverUrls.push(it.url);
    }
    const user = raw.user || {};
    const inter = raw.interact_info || {};
    return {
      note_id: raw.note_id,
      title: raw.display_title || raw.title || '',
      type: raw.type || 'normal',
      xsec_token: raw.xsec_token || '',
      cover_url: cover.url_default || cover.url_pre || '',
      cover_urls: coverUrls,
      author_id: user.user_id || '',
      author_name: user.nickname || '',
      author_avatar: user.avatar || '',
      author_xsec_token: user.xsec_token || '',
      liked_count: inter.liked_count != null ? String(inter.liked_count) : '',
      liked: !!inter.liked,
      source,
      folder: folder || '',
      note_url: raw.xsec_token
        ? `https://www.xiaohongshu.com/explore/${raw.note_id}?xsec_token=${raw.xsec_token}`
        : `https://www.xiaohongshu.com/explore/${raw.note_id}`,
    };
  }

  function detectSource(url) {
    if (url.includes('/like')) return 'liked';   // 点赞接口是 /note/like/page（单数 like）
    if (url.includes('/collect')) return 'collect';
    return 'unknown';
  }

  // 识别收藏夹列表（id -> name）
  function extractBoards(url, data) {
    if (!data || data.code !== 0 || !data.data) return;
    let list = null;
    if (Array.isArray(data.data)) list = data.data;
    else if (Array.isArray(data.data.collects)) list = data.data.collects;
    else if (Array.isArray(data.data.albums)) list = data.data.albums;
    else if (Array.isArray(data.data.list)) list = data.data.list;
    if (!list) return;
    for (const b of list) {
      if (b && b.id && (b.name || b.title)) {
        boards.set(String(b.id), b.name || b.title);
      }
    }
  }

  // 从笔记列表 URL 里取收藏夹 id
  function extractBoardId(url) {
    try {
      const q = url.split('?')[1];
      if (!q) return '';
      const params = new URLSearchParams(q);
      return params.get('collect_id') || params.get('album_id') || params.get('collection_id') || params.get('cid') || '';
    } catch { return ''; }
  }

  function findNotesArray(data) {
    if (!data) return null;
    if (Array.isArray(data)) return data;
    if (data.code === 0 && data.data) {
      if (Array.isArray(data.data.notes)) return data.data.notes;
      if (Array.isArray(data.data.note_list)) return data.data.note_list;
      if (Array.isArray(data.data.items)) return data.data.items;
      if (Array.isArray(data.data.list)) return data.data.list;
    }
    return null;
  }

  // ---------- 持久化 ----------
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        seen: Array.from(seen.values()),
        urls: Array.from(interceptedUrls),
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      const s = localStorage.getItem(STORE_KEY);
      if (s) {
        const d = JSON.parse(s);
        for (const n of d.seen || []) if (n && n.note_id) seen.set(n.note_id, n);
        (d.urls || []).forEach(u => interceptedUrls.add(u));
        return (d.seen || []).length;
      }
    } catch (e) {}
    return 0;
  }

  function clearState() {
    seen.clear();
    interceptedUrls.clear();
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    updatePanel();
  }

  function processBody(url, bodyText) {
    if (typeof url !== 'string') return;
    let data;
    try { data = typeof bodyText === 'string' ? JSON.parse(bodyText) : bodyText; } catch { return; }

    // 先识别收藏夹列表（如有子文件夹）
    extractBoards(url, data);

    const notes = findNotesArray(data);
    if (!notes) return;

    interceptedUrls.add(url);
    const source = detectSource(url);
    const boardId = extractBoardId(url);
    const folder = boardId ? (boards.get(boardId) || '') : '';
    let added = false;
    for (const n of notes) {
      if (!n) continue;
      const norm = normalizeNote(n, source, folder);
      if (norm && !seen.has(norm.note_id)) { seen.set(norm.note_id, norm); added = true; }
    }
    if (added) saveState();
    updatePanel();
  }

  // ---------- 拦截 ----------
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      let url = args[0];
      if (url && typeof url === 'object') url = url.url;
      if (typeof url === 'string') resp.clone().text().then(t => processBody(url, t)).catch(() => {});
    } catch (e) {}
    return resp;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xhsUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      if (!this.__xhsUrl) return;
      const body = this.responseText || (this.response ? JSON.stringify(this.response) : '');
      processBody(this.__xhsUrl, body);
    });
    return origSend.apply(this, arguments);
  };

  // ---------- 滚动 ----------
  function scrollDown() {
    window.scrollTo(0, document.body.scrollHeight);
    // 再滚动页面里所有可滚动的容器（有些 SPA 主滚动区不是 body）
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 20) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }

  function clickLoadMore() {
    const nodes = document.querySelectorAll('button, a, div, span');
    for (const n of nodes) {
      const t = (n.textContent || '').trim();
      if (t && t.length <= 8 && /加载更多|查看更多|点击加载|展开更多|继续加载/.test(t)) {
        try { n.click(); } catch (e) {}
      }
    }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function startCollect() {
    if (running) return;
    running = true;
    updatePanel();
    let noNew = 0;
    while (running) {
      const before = seen.size;
      scrollDown();
      clickLoadMore();
      await sleep(2500);
      if (seen.size === before) noNew++; else noNew = 0;
      if (noNew >= 8) { running = false; break; } // 连续 8 次无新增才停
    }
    updatePanel();
  }

  // ---------- 面板 ----------
  function sourceStat() {
    const s = {};
    for (const v of seen.values()) s[v.source] = (s[v.source] || 0) + 1;
    return Object.entries(s).map(([k, c]) => `${k}:${c}`).join(' ');
  }

  function updatePanel() {
    if (!window.__panel) return;
    const stat = document.getElementById('__xhs_stat');
    if (stat) stat.textContent = `已采集 ${seen.size} 条（${sourceStat() || '暂无'}）${running ? ' · 采集中…' : ''}`;
  }

  function makePanel() {
    const restored = loadState();
    const p = document.createElement('div');
    p.id = '__xhs_panel';
    p.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#fff;' +
      'padding:12px 14px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.18);' +
      'font-size:13px;color:#333;display:flex;flex-direction:column;gap:8px;min-width:220px;';
    p.innerHTML = `
      <div style="font-weight:700;color:#ff2442">小红书采集器</div>
      <div id="__xhs_stat">已采集 ${seen.size} 条${restored ? '（已恢复上次进度）' : ''}</div>
      <div style="display:flex;gap:6px">
        <button id="__xhs_start" style="flex:1;padding:7px;border:none;border-radius:6px;background:#ff2442;color:#fff;cursor:pointer">开始采集</button>
        <button id="__xhs_stop" style="flex:1;padding:7px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">停止</button>
      </div>
      <button id="__xhs_export" style="padding:7px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">导出 JSON</button>
      <button id="__xhs_clear" style="padding:5px;border:none;background:none;color:#999;cursor:pointer;font-size:11px">清空已采集</button>
      <div style="font-size:11px;color:#999">有收藏夹？逐个点进去滚动，脚本自动标注所属收藏夹；进度自动保存，刷新不丢</div>
    `;
    document.documentElement.appendChild(p);
    window.__panel = p;

    document.getElementById('__xhs_start').addEventListener('click', startCollect);
    document.getElementById('__xhs_stop').addEventListener('click', () => { running = false; updatePanel(); });
    document.getElementById('__xhs_export').addEventListener('click', exportJson);
    document.getElementById('__xhs_clear').addEventListener('click', clearState);
  }

  function exportJson() {
    const notes = Array.from(seen.values());
    const data = {
      meta: {
        source: sourceStat(),
        total: notes.length,
        captured_at: new Date().toISOString(),
        urls: Array.from(interceptedUrls),
      },
      notes,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xhs-notes-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  window.addEventListener('DOMContentLoaded', makePanel);
  if (document.readyState !== 'loading') makePanel();
})();
