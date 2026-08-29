// ==UserScript==
// @name         知乎收藏自动采集器
// @namespace    local.xhs-kb
// @version      0.1
// @description  自动遍历知乎所有收藏夹及条目（直接分页抓取，无需滚动/点击），去重导出 JSON
// @match        https://www.zhihu.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const collections = [];   // { id, title, ... }
  const notes = [];         // 规范化结果
  const rawItems = [];      // 原始条目（含所属收藏夹），用于校验
  const seenIds = new Set();
  let running = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function zhGet(url) {
    const resp = await fetch(url, {
      headers: { 'x-requested-with': 'fetch' },
      credentials: 'include',
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
    return resp.json();
  }

  // 获取当前用户 ID
  async function getMemberId() {
    try {
      const me = await zhGet('/api/v4/me');
      if (me && (me.id || me.url_token)) return me.id || me.url_token;
    } catch (e) {}
    // 兜底：从收藏页 URL 里取 people/{token}
    const m = location.pathname.match(/\/people\/([^/]+)/);
    if (m) return m[1];
    throw new Error('无法获取当前用户 ID，请先打开 zhihu.com 的「收藏」页');
  }

  // 抓所有收藏夹（分页）
  async function fetchAllCollections(memberId) {
    const all = [];
    let offset = 0;
    const limit = 20;
    while (true) {
      const url = `/api/v4/people/${memberId}/collections?offset=${offset}&limit=${limit}`;
      const data = await zhGet(url);
      const list = data.data || [];
      for (const c of list) all.push({ id: c.id, title: c.title || '未命名收藏夹' });
      if (data.paging && data.paging.is_end) break;
      if (list.length === 0) break;
      offset += limit;
      await sleep(200);
    }
    return all;
  }

  // 抓某个收藏夹的所有条目（分页）
  async function fetchCollectionItems(collectionId, folderTitle) {
    let offset = 0;
    const limit = 20;
    while (true) {
      const url = `/api/v4/collections/${collectionId}/items?offset=${offset}&limit=${limit}`;
      const data = await zhGet(url);
      const list = data.data || [];
      for (const item of list) {
        rawItems.push({ folder: folderTitle, item });
        const norm = normalizeItem(item, folderTitle);
        if (norm && !seenIds.has(norm.note_id)) {
          seenIds.add(norm.note_id);
          notes.push(norm);
        }
      }
      if (data.paging && data.paging.is_end) break;
      if (list.length === 0) break;
      offset += limit;
      await sleep(150);
    }
  }

  // 归一化条目（answer / article / video / pin 等）
  function normalizeItem(item, folder) {
    const content = item.content || item || {};
    const type = item.type || content.type || 'unknown';
    let title = '', url = '', author = '', excerpt = '';

    if (type === 'answer') {
      title = (content.question && content.question.title) || '';
      url = content.url || (content.question && content.question.url ? content.question.url + '/answer/' + content.id : '');
      author = (content.author && content.author.name) || '';
      excerpt = content.excerpt || '';
    } else if (type === 'article') {
      title = content.title || '';
      url = content.url || '';
      author = (content.author && content.author.name) || '';
      excerpt = content.excerpt || '';
    } else if (type === 'video' || type === 'zvideo') {
      title = content.title || content.excerpt || '';
      url = content.url || '';
      author = (content.author && content.author.name) || '';
      excerpt = content.excerpt || '';
    } else if (type === 'pin') {
      const rawText = content.excerpt || content.content || '';
      title = String(rawText).slice(0, 60);
      url = content.url || '';
      author = (content.author && content.author.name) || '';
      excerpt = String(rawText).slice(0, 100);
    } else {
      title = content.title || (content.question && content.question.title) || content.excerpt || '';
      url = content.url || '';
      author = (content.author && content.author.name) || '';
      excerpt = content.excerpt || '';
    }

    const id = String(content.id || item.id || '');
    if (!id) return null;
    return {
      note_id: id,
      title: title || excerpt || '(无标题)',
      type,
      author,
      url,
      excerpt,
      folder,
      app: 'zhihu',
    };
  }

  // ---------- 主流程 ----------
  async function start() {
    if (running) return;
    running = true;
    updatePanel();
    try {
      const memberId = await getMemberId();
      log(`用户 ID: ${memberId}`);

      const cols = await fetchAllCollections(memberId);
      collections.length = 0;
      collections.push(...cols);
      log(`共 ${cols.length} 个收藏夹`);

      for (let i = 0; i < cols.length; i++) {
        if (!running) break;
        log(`[${i + 1}/${cols.length}] 采集「${cols[i].title}」…`);
        await fetchCollectionItems(cols[i].id, cols[i].title);
        updatePanel(i + 1, cols.length);
      }
      log(`完成：共 ${notes.length} 条`);
    } catch (e) {
      log(`出错：${e.message}`);
    }
    running = false;
    updatePanel();
  }

  // ---------- 面板 ----------
  function updatePanel(doneCols, totalCols) {
    const stat = document.getElementById('__zh_stat');
    if (!stat) return;
    let s = `已采集 ${notes.length} 条`;
    if (doneCols != null && totalCols) s += ` · 收藏夹 ${doneCols}/${totalCols}`;
    if (running) s += ' · 采集中…';
    stat.textContent = s;
    const logEl = document.getElementById('__zh_log');
    if (logEl) logEl.textContent = lastLog || '';
  }

  let lastLog = '';
  function log(msg) {
    lastLog = msg;
    console.log('[知乎采集]', msg);
    updatePanel();
  }

  function makePanel() {
    const p = document.createElement('div');
    p.id = '__zh_panel';
    p.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#fff;' +
      'padding:12px 14px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.18);' +
      'font-size:13px;color:#333;display:flex;flex-direction:column;gap:8px;min-width:240px;';
    p.innerHTML = `
      <div style="font-weight:700;color:#0066ff">知乎收藏采集器</div>
      <div id="__zh_stat">已采集 0 条</div>
      <div id="__zh_log" style="font-size:11px;color:#999;max-width:230px;word-break:break-all"></div>
      <div style="display:flex;gap:6px">
        <button id="__zh_start" style="flex:1;padding:7px;border:none;border-radius:6px;background:#0066ff;color:#fff;cursor:pointer">开始采集</button>
        <button id="__zh_stop" style="flex:1;padding:7px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">停止</button>
      </div>
      <button id="__zh_export" style="padding:7px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">导出 JSON</button>
      <div style="font-size:11px;color:#999">打开 zhihu.com 任意页面，点开始采集，自动遍历所有收藏夹</div>
    `;
    document.documentElement.appendChild(p);

    document.getElementById('__zh_start').addEventListener('click', start);
    document.getElementById('__zh_stop').addEventListener('click', () => { running = false; updatePanel(); });
    document.getElementById('__zh_export').addEventListener('click', exportJson);
  }

  function exportJson() {
    const data = {
      meta: { app: 'zhihu', total: notes.length, folders: collections.length, captured_at: new Date().toISOString() },
      notes,
      raw: rawItems,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zhihu-notes-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  window.addEventListener('DOMContentLoaded', makePanel);
  if (document.readyState !== 'loading') makePanel();
})();
