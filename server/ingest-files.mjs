// 批量导入本地文件：node server/ingest-files.mjs <目录> [--move]
// 默认复制进 data/files/；--move 表示移动（导入后原文件删除）。
// 文本类文件（md/txt/csv/json/代码等）自动读取内容，供全文搜索与 LLM 分类使用。
import { readdirSync, statSync, readFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';
import { registerLocalFile, FILES_DIR } from './files.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const move = args.includes('--move');
const dirArg = args.find(a => !a.startsWith('--'));
if (!dirArg) {
  console.error('用法：node server/ingest-files.mjs <目录> [--move]');
  console.error('  例：node server/ingest-files.mjs "E:\\我的文档" --move');
  process.exit(1);
}
const srcDir = path.resolve(dirArg);
if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
  console.error('目录不存在：' + srcDir);
  process.exit(1);
}

const db = openDb();
mkdirSync(FILES_DIR, { recursive: true });

const files = readdirSync(srcDir).filter(f => statSync(path.join(srcDir, f)).isFile());

let added = 0, existed = 0;
for (const f of files) {
  const src = path.join(srcDir, f);
  const dest = path.join(FILES_DIR, f);
  if (move) {
    renameSync(src, dest);
    registerLocalFile(db, f, readFileSync(dest));
  } else {
    registerLocalFile(db, f, readFileSync(src));
  }
  const row = db.prepare('SELECT category FROM notes WHERE note_id = ?').get('file:' + f);
  if (row?.category) { existed++; console.log(`  已存在（保留分类） ${f}`); }
  else { added++; console.log(`  + 新增 ${f}`); }
}

console.log(`\n完成：${files.length} 个文件（新增待分类 ${added}，已存在 ${existed}）`);
console.log('文件保存在：' + FILES_DIR);
console.log('下一步：node server/classify.mjs 自动分类');
