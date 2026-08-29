// 用 DeepSeek 给笔记打两个分：时效性（timeliness）+ 内容广度（breadth）
// 用法：node server/evaluate.mjs [--limit N] [--concurrency N]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const configPath = path.join(__dirname, '..', 'config.json');
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const API_KEY = process.env.DEEPSEEK_API_KEY || config.deepseek?.api_key || '';
const BASE_URL = process.env.DEEPSEEK_BASE_URL || config.deepseek?.base_url || 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL || config.deepseek?.model || 'deepseek-chat';

const SYSTEM = `你是一个内容评价助手。根据内容的标题、分类和摘要，从两个维度打分。

timeliness（时效性）：1-10 整数，10=常青知识（长期不过时），1=强时效（很快过时，如新闻/活动/当期攻略）
breadth（广度）：1-10 整数，10=宏观综述/方法论（覆盖面广），1=具体深挖/单一细节

只输出 JSON，格式严格如下（不要输出任何其他文字）：
{"timeliness":7,"breadth":5}`;

function userPrompt(note) {
  let text = `标题：${note.title || '（无标题）'}`;
  if (note.category) text += `\n分类：${note.category}${note.subcategory ? '·' + note.subcategory : ''}`;
  if (note.summary) text += `\n摘要：${note.summary}`;
  if (note.desc) text += `\n内容摘要：${String(note.desc).slice(0, 200)}`;
  return text;
}

function clamp(n) {
  n = parseInt(n, 10);
  if (isNaN(n)) return null;
  return Math.max(1, Math.min(10, n));
}

async function evaluateOne(note) {
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPrompt(note) },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(content);
  return { timeliness: clamp(parsed.timeliness), breadth: clamp(parsed.breadth) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!API_KEY) {
    console.error('❌ 未配置 DeepSeek API Key。请编辑 config.json 填入 api_key。');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const limitIdx = args.findIndex(a => a.startsWith('--limit'));
  let limit = Infinity;
  if (limitIdx !== -1) {
    const v = args[limitIdx].includes('=') ? args[limitIdx].split('=')[1] : args[limitIdx + 1];
    if (v && !isNaN(Number(v))) limit = Number(v);
  }
  const concIdx = args.findIndex(a => a.startsWith('--concurrency'));
  let concurrency = 4;
  if (concIdx !== -1) {
    const v = args[concIdx].includes('=') ? args[concIdx].split('=')[1] : args[concIdx + 1];
    if (v && !isNaN(Number(v))) concurrency = Math.max(1, Math.min(8, Number(v)));
  }

  const db = openDb();
  const todos = db.prepare(
    'SELECT note_id, title, desc, folder, category, subcategory, summary FROM notes WHERE timeliness IS NULL ORDER BY rowid'
  ).all().slice(0, limit);

  console.log(`待评价: ${todos.length} 条（模型 ${MODEL}，并发 ${concurrency}）`);
  if (todos.length === 0) return;

  const upd = db.prepare('UPDATE notes SET timeliness=?, breadth=? WHERE note_id=?');

  let done = 0, failed = 0, idx = 0;
  async function worker() {
    while (idx < todos.length) {
      const note = todos[idx++];
      let result = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { result = await evaluateOne(note); break; }
        catch (e) {
          if (attempt === 2) { failed++; console.error(`  ✗ ${note.title?.slice(0, 20)}: ${e.message}`); }
          else await sleep(1500 * (attempt + 1));
        }
      }
      if (result) {
        upd.run(result.timeliness, result.breadth, note.note_id);
        done++;
        console.log(`  [${done}/${todos.length}] 时效${result.timeliness} 广度${result.breadth} | ${note.title?.slice(0, 24)}`);
      }
      await sleep(80);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const evaluated = db.prepare('SELECT COUNT(*) c FROM notes WHERE timeliness IS NOT NULL').get().c;
  console.log(`\n完成：成功 ${done}，失败 ${failed}。当前已评价 ${evaluated} 条。`);
}

main().catch(e => { console.error(e); process.exit(1); });
