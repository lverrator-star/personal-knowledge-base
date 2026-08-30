// 每日回顾提醒：把 N 条未回顾笔记推送到微信 / QQ
// 用法：
//   node server/remind.mjs          正常发送（供计划任务调用）
//   node server/remind.mjs --test   立即测试一次
//   node server/remind.mjs --dry    只生成消息不发送（打印预览）
//
// 配置：config.json 的 push 字段，例如：
//   "push": {
//     "channel": "serverchan",   // serverchan（微信） / pushplus（微信） / qqbot（QQ官方机器人）
//     "token": "SCTxxxxxx",      // serverchan: SendKey；pushplus: token；qqbot: "appId|clientSecret|群openid"
//     "time": "21:00",           // 提醒时间（由计划任务执行，这里仅作记录）
//     "count": 3,                // 每次推几条
//     "web": ["http://192.168.1.28:8787", "http://100.x.y.z:8787"]  // 知识库地址（可多个：局域网 + Tailscale 等）
//   }
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '..', 'config.json');
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const push = config.push || {};

const db = openDb();

// ---------- 选笔记 ----------
function pickNotes(count) {
  const picked = [];
  const seen = new Set();
  // 优先挑已分类的未回顾笔记
  const classified = db.prepare(
    'SELECT * FROM notes WHERE reviewed=0 AND category IS NOT NULL ORDER BY RANDOM() LIMIT ?'
  ).all(count);
  for (const n of classified) { picked.push(n); seen.add(n.note_id); }
  if (picked.length < count) {
    const rest = db.prepare(
      'SELECT * FROM notes WHERE reviewed=0 ORDER BY RANDOM() LIMIT ?'
    ).all(count - picked.length);
    for (const n of rest) { if (!seen.has(n.note_id)) picked.push(n); }
  }
  return picked;
}

// ---------- 消息 ----------
const monthDay = `${new Date().getMonth() + 1}月${new Date().getDate()}日`;

function buildMessage(notes) {
  const total = db.prepare('SELECT COUNT(*) c FROM notes').get().c;
  const reviewed = db.prepare('SELECT COUNT(*) c FROM notes WHERE reviewed=1').get().c;
  const unreviewed = total - reviewed;

  if (notes.length === 0) {
    return {
      title: '🎉 知识库全部回顾完成！',
      md: `📖 **个人知识库 · ${monthDay}**\n\n恭喜！**${total}** 条笔记已全部回顾完。\n\n想再来一轮，去知识库「回顾」页点「重新开始一轮」；也可以继续采集新内容。`,
    };
  }

  const lines = [
    `📖 **个人知识库 · 每日回顾**（${monthDay}）`,
    ``,
    `已回顾 ${reviewed} / ${total}，还剩 **${unreviewed}** 条`,
    ``,
    `**今天看这 ${notes.length} 条：**`,
  ];
  notes.forEach((n, i) => {
    const cat = n.category ? `【${n.category}】` : '';
    lines.push(`${i + 1}. ${cat}${n.title || '（无标题）'}`);
    if (n.note_url && n.note_url.startsWith('http')) lines.push(`   ${n.note_url}`);
  });
  const webs = Array.isArray(push.web) ? push.web : (push.web ? [push.web] : []);
  if (webs.length) {
    lines.push('', '**开始回顾：**');
    webs.forEach((w, i) => lines.push(`- ${webs.length > 1 ? (i === 0 ? '家里 WiFi：' : '出门在外：') : ''}[打开知识库 →](${w}/#review)`));
  } else {
    lines.push('', `打开电脑上的「个人知识库」→「回顾」页开始回顾`);
  }

  return { title: `📖 知识库每日回顾（${monthDay}）`, md: lines.join('\n') };
}

function mdToText(md) {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/📖\s*/, '📖 ');
}

// ---------- 渠道 ----------
async function sendServerChan(title, md) {
  const url = `https://sctapi.ftqq.com/${push.token}.send`;
  const body = new URLSearchParams({ title, desp: md }).toString();
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.code !== 0) throw new Error(`Server酱返回错误：${JSON.stringify(data).slice(0, 200)}`);
}

async function sendPushPlus(title, md) {
  const resp = await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: push.token, title, content: md, template: 'markdown' }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || (data.code != null && data.code !== 200)) throw new Error(`PushPlus 返回错误：${JSON.stringify(data).slice(0, 200)}`);
}

async function sendQqBot(text) {
  const [appId, clientSecret, groupOpenid] = String(push.token || '').split('|');
  if (!appId || !clientSecret || !groupOpenid) throw new Error('qqbot 的 token 格式应为 "appId|clientSecret|群openid"');
  // 1. 换取 access_token
  const tResp = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret }),
  });
  const tData = await tResp.json().catch(() => ({}));
  const accessToken = tData.access_token;
  if (!tResp.ok || !accessToken) throw new Error(`QQ 获取 access_token 失败：${JSON.stringify(tData).slice(0, 200)}`);
  // 2. 发群消息
  const resp = await fetch(`https://api.sgroup.qq.com/v2/groups/${groupOpenid}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `QQBot ${accessToken}`,
    },
    body: JSON.stringify({ content: text, msg_type: 0, msg_id: String(Date.now()) }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || (data.code != null && data.code !== 0)) throw new Error(`QQ 发送失败：${JSON.stringify(data).slice(0, 200)}`);
}

async function send({ title, md }, channel) {
  const text = mdToText(md);
  if (channel === 'serverchan') return sendServerChan(title, md);
  if (channel === 'pushplus') return sendPushPlus(title, md);
  if (channel === 'qqbot') return sendQqBot(text);
  throw new Error(`未知渠道：${channel}（可选 serverchan / pushplus / qqbot）`);
}

// ---------- 主流程 ----------
async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const test = args.includes('--test');
  const channel = push.channel || 'serverchan';
  const count = Math.max(1, Math.min(10, Number(push.count) || 3));
  const hasToken = !!push.token;

  const notes = pickNotes(count);
  const msg = buildMessage(notes);

  console.log('━━━ 回顾提醒消息预览 ━━━');
  console.log(msg.md);
  console.log('━━━━━━━━━━━━━━━━━━━━━━');

  if (dry) return console.log('（--dry 模式，未发送）');

  if (!hasToken) {
    console.log('⚠️ 尚未配置 push.token，未实际发送。');
    console.log('   请编辑 config.json 的 push 字段填入 token，再运行 node server/remind.mjs --test 验证。');
    return;
  }

  try {
    await send(msg, channel);
    console.log(`✅ 已通过 ${channel} 发送（${notes.length} 条待回顾笔记）`);
    if (test) console.log('   测试成功！计划任务会在每天设定时间自动发送。');
  } catch (e) {
    console.error(`❌ 发送失败：${e.message}`);
    process.exitCode = 1;
  }
}

main();
