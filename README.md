# 智能化代办 · Intelligent-ToDo

> 基于艾森豪威尔矩阵（四象限法则）+ AI 智能优先排序的桌面待办应用，让你的每一天都聚焦在最重要的事情上。

一个使用 Electron + React + TypeScript 构建的跨平台桌面应用。它不只是又一个待办清单——它把「四象限法则」和「AI 智能分析」结合起来，每天帮你回答那个最难的问题：**今天到底该先做什么？**

---

## ✨ 核心特性

### 1. 任务看板（四象限法则）
把任务按「重要性 × 紧急程度」分到四个象限，一眼看清优先级：

| 象限 | 含义 | 策略 |
|------|------|------|
| 🔴 重要 且 紧急 | Q1 — 危机、截止任务 | 立即去做 |
| 🔵 重要 不 紧急 | Q2 — 长期价值事项 | 制定计划 |
| 🟠 不重要 但 紧急 | Q3 — 打断、琐事 | 尽量委派 |
| ⚪ 不重要 不 紧急 | Q4 — 消遣、噪音 | 稍后再说 |

每个任务支持：截止日期、完成状态、逾期提醒、一键编辑/删除。

### 2. 今日优先（AI 智能分析）🎯
**不是简单的问答弹窗，而是一个专属工作台：**

- **左侧**：实时显示当前的任务四象限（紧凑模式），随时查看全局
- **右侧**：AI 根据四象限法则 + 截止日期，智能推荐今日 3-5 个最该优先完成的任务
- **代办形式呈现**：每条推荐都是一个可交互的待办项
  - ☑️ **打钩完成**：前面的复选框直接标记完成
  - 📊 **进度刷新**：5 档进度按钮（0% / 25% / 50% / 75% / 100%），点击即可更新进度
  - 💡 **AI 推荐理由**：每条都附带「为什么今天要先做这个」的说明
- **双向同步**：在四象限里勾选任务，会自动同步到今日优先；反之亦然。进度达到 100% 自动完成。

### 3. 历史回顾 📅
每天的 AI 分析结果都会**自动存档**。切到「历史」标签：
- 按日期倒序排列，每天显示当时的行动建议和完成情况
- 点击展开查看当天所有优先项的完成状态和进度
- 完整记录你的每一天，便于复盘

### 4. 数据安全与隐私
- 所有数据**仅保存在本地**（`userData/todo-data.json`），不上传任何服务器
- AI API Key 使用**操作系统级加密**存储（Windows DPAPI / macOS Keychain）
- 数据文件损坏时自动备份并恢复，不会丢失原始数据

### 5. Markdown 导出
一键把全部任务按四象限分组导出为 `.md` 文件，方便归档或分享。

---

## 🖼️ 界面预览

```
┌──────────────────────────────────────────────────────────────┐
│  智能化代办   [任务看板] [今日优先]   +新建任务  导出MD    ⚙  │
├──────────────────────────────┬───────────────────────────────┤
│  ┌──────────┬──────────┐     │  今日优先                     │
│  │ Q1 重要  │ Q2 重要  │     │  [今日]  [历史 (3)]           │
│  │ 且紧急   │ 不紧急   │     │  ┌─────────────────────────┐  │
│  ├──────────┼──────────┤     │  │ 💡 今日行动建议          │  │
│  │ Q3 不重要│ Q4 不重要│     │  │ 先处理 Q1 的截止任务...  │  │
│  │ 但紧急   │ 不紧急   │     │  └─────────────────────────┘  │
│  └──────────┴──────────┘     │  ☐ 写季度报告   [#1] 25%▓▓░░ │
│                              │  ☑ 修复线上 Bug  [#2] 100%✓  │
│       (紧凑四象限)            │  ☐ 复习英语     [#3] 0%░░░░  │
│                              │       (今日优先待办)           │
└──────────────────────────────┴───────────────────────────────┘
```

---

## 🛠️ 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 桌面框架 | **Electron 33** | 跨平台桌面应用 |
| 构建工具 | **electron-vite + Vite 5** | 极速 HMR 与打包 |
| 前端 | **React 18 + TypeScript 5** | 严格类型，零 `any` |
| 进程通信 | **IPC + contextBridge** | 安全的 main ↔ renderer 隔离 |
| 样式 | **原生 CSS + CSS 变量** | 无 UI 框架依赖，轻量定制 |
| AI | **OpenAI 兼容 API** | 支持 OpenAI / DeepSeek / 任何兼容接口 |

**零运行时第三方 UI 依赖**——整个界面基于原生 CSS 变量主题系统手工打造，启动快、包体小。

---

## 🚀 快速开始

### 环境要求
- Node.js ≥ 18
- npm ≥ 9

### 安装与运行
```bash
# 克隆仓库
git clone git@github.com:SCUT-Mida/Intelligent-ToDo.git
cd Intelligent-ToDo

# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 打包生产版本（当前平台）
npm run build
npm start

# 构建 Windows 安装包
npm run build:win
```

### 配置 AI
首次使用「今日优先」前，需要配置 AI 接口：

1. 点击工具栏右上角的 ⚙ 图标
2. 填写：
   - **API 地址**：如 `https://api.openai.com/v1`（OpenAI 协议兼容即可，无需带 `/chat/completions`）
   - **API Key**：你的密钥（仅本地加密存储）
   - **模型名称**：如 `gpt-4o-mini`、`deepseek-chat` 等
3. 保存后，进入「今日优先」标签，点击「开始智能分析」

> 💡 推荐使用性价比高的模型（如 `gpt-4o-mini`、`deepseek-chat`），日常优先排序足够。

---

## 📁 项目结构

```
Intelligent-ToDo/
├── src/
│   ├── main/
│   │   └── index.ts            # Electron 主进程：持久化、IPC、AI 调用、密钥加密
│   ├── preload/
│   │   ├── index.ts            # preload 脚本：暴露安全 API 给渲染进程
│   │   └── index.d.ts          # window.api 类型声明
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx        # React 入口
│   │       ├── App.tsx         # 应用根组件（视图切换、状态管理、AI 同步逻辑）
│   │       ├── components/
│   │       │   ├── QuadrantBoard.tsx      # 四象限看板（支持紧凑模式）
│   │       │   ├── TodayPriorityView.tsx # 今日优先工作台（左右分栏）
│   │       │   ├── TaskModal.tsx         # 任务编辑弹窗
│   │       │   └── ConfigModal.tsx       # AI 配置弹窗
│   │       ├── lib/
│   │       │   └── markdown.ts            # Markdown 导出工具
│   │       └── styles/
│   │           └── global.css             # 全局样式与主题（CSS 变量）
│   └── shared/
│       └── types.ts            # 主进程与渲染进程共享的类型定义
├── docs/                       # 项目文档
├── electron.vite.config.ts     # electron-vite 配置
├── tsconfig*.json              # TypeScript 配置
└── package.json
```

---

## 📖 文档

- [架构设计](./docs/architecture.md) — 进程模型、数据流、状态管理详解
- [AI 集成说明](./docs/ai-integration.md) — AI 接口协议、Prompt 设计、JSON 解析策略

---

## 🔒 数据存储

所有用户数据保存在系统 userData 目录下：

| 平台 | 路径 |
|------|------|
| Windows | `C:\Users\<用户>\AppData\Roaming\intelligent-todo\todo-data.json` |
| macOS | `~/Library/Application Support/intelligent-todo/todo-data.json` |
| Linux | `~/.config/intelligent-todo/todo-data.json` |

数据结构包含：
- `tasks`：所有任务
- `config`：AI 配置（密钥加密存储）
- `priorities`：每日 AI 优先级快照（历史记录）

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。提交前请确保：
- `npm run build` 通过（零 TypeScript 错误）
- 不引入 `any` / `@ts-ignore` 等类型逃逸
- 遵循现有的代码风格与命名约定

---

## 📄 许可证

[MIT License](./LICENSE)
