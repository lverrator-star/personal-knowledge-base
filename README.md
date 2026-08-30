# 个人知识库（Personal Knowledge Base）

把小红书、知乎等社交平台的「收藏 / 点赞」内容，采集到本地，自动分类整理，变成一个**可检索、可筛选、可回顾**的个人知识库。

> 你的收藏夹，不该吃灰。

🔗 **在线预览**（作者知识库的静态演示，GitHub Pages）：https://lverrator-star.github.io/personal-knowledge-base/

## ✨ 特性

- 🌐 **多平台**：小红书（收藏 + 点赞）、知乎（收藏夹，含子文件夹），架构可扩展更多平台
- 🤖 **自动分类**：DeepSeek 大模型自动分类（一级大类 + 二级小类）+ 打标签 + 一句话摘要
- 🔍 **检索**：关键词搜索 + 分类 / 收藏夹 / 来源 / 小类 / 标签 多维筛选 + 按点赞数排序
- 📊 **仪表盘**：Apple 小组件风格——平台占比、分类分布、小类聚合、回顾进度可视化
- 🕸️ **知识图谱**：分类关联图谱 + 单笔记关系图谱（共享标签连线、缩放平移、拖拽）
- 🏷️ **标签云**：按标签浏览全部收藏，点标签即筛选
- 📖 **防吃灰**：独立「回顾」页随机推荐旧收藏，一键标记已回顾（支持快捷键 ←→），循环复习
- 📬 **每日推送**：定时把回顾清单推送到微信 / QQ（Server酱 / PushPlus / QQ机器人）
- 📤 **导出**：Markdown / JSON 一键导出备份
- 📱 **移动端**：PWA——手机浏览器「添加到主屏幕」即得 APP 图标
- 🌍 **静态预览**：一键生成纯静态站点（server/export-static.mjs），可托管 GitHub Pages 分享给别人看
- 🔒 **纯本地**：数据存本地 SQLite，不出本机
- 💰 **零成本**：纯 Node 内置模块（http + sqlite + fetch），无第三方依赖；分类成本几分钱

## 🏗️ 架构

```
浏览器（已登录社交平台）
  └─ 油猴脚本：拦截网页自身接口响应 / 直接分页请求
        │  导出 JSON
        ▼
Node 后端（http + node:sqlite）
  ├─ 入库去重（多平台、收藏/点赞/文件夹维度）
  ├─ 调 DeepSeek 自动分类 + 打标签 + 摘要
  └─ REST API + 静态前端
        │
        ▼
Web 工具台（vanilla JS，无构建）
  ├─ 平台切换 / 分类 / 收藏夹 / 来源 / 小类筛选
  ├─ 搜索 / 排序 / 详情 / 导出
  └─ 仪表盘（可视化 + 今日回顾）
```

**关键思路**：采集时**不自己拼请求**（社交平台有签名反爬），而是**拦截网页自己发出的接口响应**，绕开反爬签名。

## 🚀 快速开始

### 前提

- Node.js ≥ 22（内置 `node:sqlite`）
- 浏览器装了 [Tampermonkey](https://www.tampermonkey.net/)（油猴）
- 一个 DeepSeek API key（分类用，[platform.deepseek.com](https://platform.deepseek.com) 注册）

### 1. 启动服务

```bash
npm start          # 或 node server/server.mjs
```

打开浏览器访问 **http://localhost:8787**（此时还没有数据）。

### 2. 采集数据

在 Tampermonkey 里新建脚本，分别粘贴以下两个采集脚本（互不冲突）：

| 平台 | 脚本 | 用法 |
|---|---|---|
| 小红书 | `collector.user.js` | 打开「收藏/点赞」页 → 点「开始采集」→ 导出 JSON |
| 知乎 | `zhihu-collector.user.js` | 打开知乎任意页 → 点「开始采集」→ 自动遍历所有收藏夹 → 导出 JSON |

### 3. 入库 + 分类

把导出的 JSON 文件放到项目目录，执行：

```bash
node server/ingest.mjs 你的小红书文件.json --source=liked   # 或 --source=collect
node server/ingest-zhihu.mjs 你的知乎文件.json

cp config.example.json config.json   # 填入你的 DeepSeek API key
node server/classify.mjs             # 自动分类（可断点续跑）
```

刷新 http://localhost:8787，即可浏览、筛选、回顾你的知识库。

## 📁 目录结构

```
├── collector.user.js        # 小红书采集器（油猴脚本）
├── zhihu-collector.user.js  # 知乎采集器（油猴脚本）
├── server/
│   ├── server.mjs           # HTTP 服务 + REST API + 静态前端
│   ├── db.mjs               # SQLite schema + 迁移
│   ├── ingest.mjs           # 小红书数据入库
│   ├── ingest-zhihu.mjs     # 知乎数据入库
│   └── classify.mjs         # DeepSeek 自动分类
├── web/                     # 前端（vanilla JS，无构建）
├── config.example.json      # 配置模板（复制为 config.json 填 key）
└── data/                    # SQLite 数据库（自动生成，gitignore）
```

## 🔒 隐私说明

- 所有数据保存在**本机** `data/` 目录的 SQLite 文件里，不上传任何服务器；
- 分类仅把「标题 + 摘要」发送给你自己配置的 DeepSeek API；
- 仓库已通过 `.gitignore` 排除所有数据文件与 `config.json`，公开代码**不会泄露你的收藏**。

## 🧩 扩展更多平台

新增一个平台只需三步：

1. 写一个采集脚本（拦截该平台的收藏/列表接口，导出统一 JSON）；
2. 加一个 `ingest-xxx.mjs` 入库脚本（映射到 `app` 字段）；
3. 前端「平台」列表里加一项。

## 📬 每日回顾提醒（推送到微信 / QQ）

配置 `config.json` 的 `push` 字段，每天定时把「未回顾笔记」清单推到手机：

| 渠道 | channel 值 | token 获取方式 |
|---|---|---|
| **Server酱**（微信服务号） | `serverchan` | [sct.ftqq.com](https://sct.ftqq.com) 微信扫码登录 → 复制 SendKey |
| **PushPlus**（微信服务号） | `pushplus` | [pushplus.plus](https://www.pushplus.plus) 微信扫码登录 → 复制 token |
| **QQ 官方机器人**（进阶） | `qqbot` | [bot.qq.com](https://bot.qq.com) 注册开发者、创建机器人，token 填 `"appId\|clientSecret\|群openid"` |

```json
"push": {
  "channel": "serverchan",
  "token": "SCTxxxxxx",
  "time": "21:00",
  "count": 3,
  "web": "http://192.168.1.28:8787"
}
```

Windows 创建每日计划任务（每天 21:00，开机错过自动补发）：

```powershell
$dt = [datetime]::ParseExact('21:00', 'HH:mm', $null)
Register-ScheduledTask -TaskName '个人知识库每日回顾' `
  -Action (New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' -Argument '"<项目路径>\server\remind.mjs"' -WorkingDirectory '<项目路径>') `
  -Trigger (New-ScheduledTaskTrigger -Daily -At $dt) `
  -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable) -Force
```

验证：`node server/remind.mjs --test`（未配置 token 时只打印消息预览，不发送）。

## 🌍 静态预览（GitHub Pages）

把知识库生成纯静态站点，发给别人即可在线浏览（浏览 / 仪表盘 / 图谱 / 标签云 / 回顾 / 导出，只读）。

**Windows 一键发布**：双击 `update-preview.bat`，自动完成生成 → 提交 → 推送 → 切回分支（数据没变化会自动跳过）。

手动流程（Mac / Linux）：

```bash
node server/export-static.mjs     # 生成 preview/ 目录
git switch gh-pages
git rm -r --cached .
cp -f preview/* .
git add index.html app.js style.css data.js manifest.json icon.svg personal-kb.md personal-kb.json
git commit -m '更新预览' && git push && git switch main
```

> ⚠️ 预览包含你的收藏列表（标题/摘要/标签），如不想公开全部内容，请勿推送。

## 📄 License

[MIT](LICENSE)
