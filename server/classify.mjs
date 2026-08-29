// 用 DeepSeek 对未分类笔记做：一级分类 + 二级分类 + 打标签 + 摘要
// 用法：node server/classify.mjs [--force] [--limit N] [--concurrency N]
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

const CATEGORIES = [
  '美食', '旅行', '穿搭', '美妆', '家居', '学习成长', '职场求职', '运动健身',
  '摄影', '情感', '萌宠', '搞笑娱乐', '科技数码', '理财投资', '健康养生',
  '文学', '历史', '哲学', '政治社会', '教育', '自然科学', '艺术', '其他',
];

const TYPE_LABEL = {
  normal: '图文', video: '视频',
  answer: '回答', article: '文章', zvideo: '视频', pin: '想法',
};

const SYSTEM = `你是一个内容分类助手。根据内容的标题、类型和摘要，判断主题，做分类、打标签、写摘要。

一级分类（category）必须从以下列表中选择，一字不差：
${CATEGORIES.join('、')}

二级分类（subcategory）是更具体的主题，用 2~6 个字的简洁中文名词自由发挥，例如：求职面试、健身、瑜伽、猫咪、恋爱、量化投资、SQL、AI工具、红楼梦、中国近代史、西方哲学、宏观经济、高等数学、英语学习、古典音乐等。要具体、可操作。

只输出 JSON，格式严格如下（不要输出任何其他文字）：
{"category":"一级分类名","subcategory":"二级分类名","tags":["标签1","标签2"],"summary":"一句话摘要"}

要求：
- category 必须一字不差地来自上面的一级分类列表；
- subcategory 必须具体到可操作的主题（2~6 字）；
- tags 为 2~5 个简短中文关键词；
- summary 不超过 30 字，概括核心内容。`;

function userPrompt(note) {
  const typeName = TYPE_LABEL[note.type] || note.type || '未知';
  let text = `标题：${note.title || '（无标题）'}\n类型：${typeName}`;
  if (note.folder) text += `\n所属收藏夹：${note.folder}`;
  if (note.desc) text += `\n内容摘要：${String(note.desc).slice(0, 300)}`;
  return text;
}

async function classifyOne(note) {
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPrompt(note) },
      ],
      temperature: 0.2,
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

  let category = String(parsed.category || '其他').trim();
  if (!CATEGORIES.includes(category)) category = '其他';

  const subcategory = String(parsed.subcategory || '').trim();
  const tags = Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 6) : [];
  const summary = String(parsed.summary || '').trim();

  return { category, subcategory, tags, summary };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!API_KEY) {
    console.error('❌ 未配置 DeepSeek API Key。请编辑 config.json 填入 api_key。');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const force = args.includes('--force');
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
  const sql = force
    ? 'SELECT note_id, title, type, desc, folder FROM notes ORDER BY rowid'
    : 'SELECT note_id, title, type, desc, folder FROM notes WHERE category IS NULL ORDER BY rowid';
  const todos = db.prepare(sql).all().slice(0, limit);

  console.log(`待分类: ${todos.length} 条（${force ? '强制重分类' : '仅未分类'}，模型 ${MODEL}，并发 ${concurrency}）`);
  if (todos.length === 0) return;

  const upd = db.prepare(
    'UPDATE notes SET category=?, subcategory=?, tags=?, summary=?, classified_at=? WHERE note_id=?'
  );

  let done = 0, failed = 0, idx = 0;

  async function worker() {
    while (idx < todos.length) {
      const note = todos[idx++];
      let result = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = await classifyOne(note);
          break;
        } catch (e) {
          if (attempt === 2) {
            failed++;
            console.error(`  ✗ ${note.title?.slice(0, 20)}: ${e.message}`);
          } else {
            await sleep(1500 * (attempt + 1));
          }
        }
      }
      if (result) {
        upd.run(result.category, result.subcategory, JSON.stringify(result.tags), result.summary, new Date().toISOString(), note.note_id);
        done++;
        const sc = result.subcategory ? `·${result.subcategory}` : '';
        console.log(`  [${done}/${todos.length}] [${result.category}${sc}] ${note.title?.slice(0, 28)}`);
      }
      await sleep(100);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const classified = db.prepare('SELECT COUNT(*) c FROM notes WHERE category IS NOT NULL').get().c;
  console.log(`\n完成：成功 ${done}，失败 ${failed}。当前已分类 ${classified} 条。`);
}

main().catch(e => { console.error(e); process.exit(1); });
