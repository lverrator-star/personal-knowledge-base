# 个人知识库（Personal Knowledge Base）

把小红书、知乎等社交平台的「收藏 / 点赞」内容，采集到本地，自动分类整理，变成一个**可检索、可筛选、可回顾**的个人知识库。

> 你的收藏夹，不该吃灰。

## ✨ 特性

- 🌐 **多平台**：小红书（收藏 + 点赞）、知乎（收藏夹，含子文件夹），架构可扩展更多平台
- 🤖 **自动分类**：DeepSeek 大模型自动分类（一级大类 + 二级小类）+ 打标签 + 一句话摘要
- 🔍 **检索**：关键词搜索 + 分类 / 收藏夹 / 来源 / 小类 多维筛选 + 按点赞数排序
- 📊 **仪表盘**：平台占比、分类分布、小类聚合可视化
- 🔄 **防吃灰**：「今日回顾」随机推荐旧收藏，标记已回顾，循环复习
- 📤 **导出**：Markdown / JSON 一键导出备份
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

## 📄 License

[MIT](LICENSE)
