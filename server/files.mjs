// 本地文件笔记的共享逻辑：入库、文本提取、文件服务
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FILES_DIR = path.join(__dirname, '..', 'data', 'files');

// 可直接读文本做全文搜索/分类的扩展名
export const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm', '.js', '.mjs', '.ts', '.py',
  '.css', '.xml', '.yaml', '.yml', '.log', '.ini', '.conf', '.sh', '.bat', '.ps1', '.c', '.h',
  '.cpp', '.java', '.go', '.rs', '.rb', '.php', '.sql', '.toml',
]);

// 文件服务 MIME
export const FILE_MIME = {
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip', '.rar': 'application/vnd.rar', '.7z': 'application/x-7z-compressed',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};

// 浏览器内可直接预览的类型
const INLINE_EXTS = new Set([
  '.pdf', '.txt', '.md', '.json', '.html', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp3', '.mp4', '.webm',
]);
export function isInlineExt(ext) { return INLINE_EXTS.has(ext); }

const DESC_MAX = 50 * 1024; // desc 最多存 50KB 文本

export function localNoteId(name) { return 'file:' + name; }

// 从 Buffer 提取文本（非文本类型返回 null）；先试 UTF-8，再试 GBK
export function extractDesc(name, buf) {
  const ext = path.extname(name).toLowerCase();
  if (!TEXT_EXTS.has(ext)) return null;
  let text = null;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {}
  if (text == null) {
    try { text = new TextDecoder('gbk').decode(buf); } catch {}
  }
  if (text == null || !text.trim()) return null;
  return text.length > DESC_MAX ? text.slice(0, DESC_MAX) : text;
}

// 把文件写入 data/files 并入库（UPSERT：重复导入保留已有分类/标签/回顾状态）
export function registerLocalFile(db, name, buf) {
  mkdirSync(FILES_DIR, { recursive: true });
  const ext = path.extname(name).toLowerCase();
  const desc = extractDesc(name, buf);
  writeFileSync(path.join(FILES_DIR, name), buf);
  const note = {
    note_id: localNoteId(name),
    title: name,
    type: ext ? ext.slice(1) : 'file',
    source: 'file',
    app: 'local',
    folder: null,
    desc,
    is_collected: 1,
    is_liked: 0,
    note_url: '/files/' + encodeURIComponent(name),
    collected_at: new Date().toISOString(),
    file_size: buf.length,
  };
  db.prepare(`
    INSERT INTO notes (note_id, title, type, source, app, folder, desc, is_collected, is_liked, note_url, collected_at, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(note_id) DO UPDATE SET
      desc = excluded.desc, file_size = excluded.file_size, collected_at = excluded.collected_at
  `).run(note.note_id, note.title, note.type, note.source, note.app, note.folder, note.desc,
    note.is_collected, note.is_liked, note.note_url, note.collected_at, note.file_size);
  return note;
}
