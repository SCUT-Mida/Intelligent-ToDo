# 本地AI工具集 · Intelligent-ToDo

> 三合一本地 AI 桌面套件：智能代办 · 仓库导航 · Agent 对话。基于 Electron + React + TypeScript 构建，数据全部留在本地。

[![Build & Release](https://github.com/SCUT-Mida/Intelligent-ToDo/actions/workflows/release.yml/badge.svg)](https://github.com/SCUT-Mida/Intelligent-ToDo/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-blue.svg)](#-下载安装)
[![Tests](https://img.shields.io/badge/tests-vitest-6e9c18.svg)](#-质量门禁)

它从一个「艾森豪威尔矩阵 + AI 优先排序」的待办应用出发，逐步长成了本地开发者的 AI 工具集（安装包快捷方式名即「本地AI工具集」），包含三个子应用：

| 子应用 | 一句话介绍 |
|--------|-----------|
| 📋 **智能代办** | 四象限任务看板 + AI「今日优先」工作台（流式输出、节假日感知） |
| 🗂 **仓库导航** | 本地 git 仓库扫描索引 + AI 仓库记忆 + 一键在终端打开并执行命令模板 |
| 💬 **Agent 对话** | CLI AI 编程助手会话管理器：嵌入式终端（ConPTY + xterm.js）运行 Claude Code / OpenCode 等原生 TUI |

---

## ✨ 核心特性

### 📋 智能代办（Todo）

- **四象限看板**：按「重要性 × 紧急程度」分四个象限，支持截止日期、循环任务（周/月/年）、5 档进度
- **今日优先（AI 工作台）**：AI 结合四象限、任务进度、截止日期与**中国法定节假日/调休规则**（内置数据 + 在线拉取覆盖）推荐今日 3-20 个优先任务，推荐项与任务双向同步；**v1.22 起支持流式输出预览**
- **历史回顾**：每日 AI 分析快照自动存档，按日期复盘
- **番茄钟 / 日历视图 / Markdown 导出**

### 🗂 仓库导航（RepoNav）

- 扫描本地 git 仓库（远程 URL、分支、最近提交），生成 `repo-nav/index.json` 索引
- **AI 记忆**：LLM 阅读仓库元数据 + README 生成中文描述与 kebab-case 标签，纯本地检索（v1.22 起显示批次进度）
- **命令模板**：一键在 Windows Terminal / PowerShell 中打开仓库并执行命令串（如 `git pull; opencode`）
- 与 Agent 对话联动：从仓库卡片直接跳转新建 Agent 会话

### 💬 Agent 对话（AgentHub）

- **会话管理**：保存（agent + 工作目录）会话，按仓库分组；**v1.22 起首个提问后由 LLM 自动生成会话标题**（手动改过的标题永不覆盖）
- **嵌入式终端**：ConPTY（`@lydell/node-pty`）+ xterm.js 6，100% 原生 CLI 交互（斜杠命令、TUI、流式输出）
- **CLI 助手支持**：Claude Code、OpenCode、codeAgent、Hermes、NGA + 用户自定义 agent（PATH 检测、`--version` 探测、每 agent 启动参数）
- **Markdown 编辑器**：所见即所得撰写 prompt，一键发送进终端；按仓库维度的问题历史

### 🔒 数据安全与隐私

- 所有数据**仅保存在本地**，不上传任何服务器
- AI API Key 使用**操作系统级加密**（Windows DPAPI / macOS Keychain）
- 数据文件损坏时自动备份（`.corrupt-<ts>`）再恢复

### 📊 AI 用量统计（v1.22）

设置 → 通用 → AI 用量统计：近 7 天 token 消耗按日柱状展示、按功能（今日优先 / 仓库记忆 / 会话标题）分列。所有 LLM 调用自动记录（429/5xx 自动退避重试）。

---

## 📥 下载安装

### 方式一：直接下载（推荐）

前往 [Releases 页面](https://github.com/SCUT-Mida/Intelligent-ToDo/releases/latest) 下载最新版本：

- **`Intelligent-ToDo-Setup-x.y.z.exe`** — NSIS 安装程序，双击安装，支持自动更新
- **`Intelligent-ToDo-x.y.z-portable.exe`** — 免安装版，单文件直接运行

> 推送 `v*` 标签时，GitHub Actions 自动构建并发布 Release（发行说明取自 annotated tag message）。

### 方式二：自行编译

见下方「快速开始」。运行 `npm run build:win` 生成与 Release 相同的安装包。

---

## 🖼️ 界面示意

```
┌────────────────────────────────────────────────────────────────────┐
│  📋 智能代办   🗂 仓库导航   💬 Agent 对话                    ⚙    │
├──────────────┬─────────────────────────────────────────────────────┤
│              │  [Todo]     四象限看板 │ 今日优先(AI推荐+流式预览)   │
│  活动栏       │  [RepoNav]  仓库卡片列表 + AI记忆 + 命令模板启动     │
│  (三应用切换) │  [AgentHub] 会话侧栏 │ Markdown编辑器 │ 嵌入式终端   │
└──────────────┴─────────────────────────────────────────────────────┘
```

三个子应用常驻挂载（display 切换），切换不中断嵌入式终端里的 agent 会话。

---

## 🛠️ 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 桌面框架 | **Electron 33** | contextIsolation 开启、nodeIntegration 关闭 |
| 构建 | **electron-vite 2 + Vite 5** / electron-builder 25（NSIS + portable） |
| 前端 | **React 18 + TypeScript 5（严格模式，零 `any`）** | 无 UI 框架，原生 CSS 变量主题 |
| 状态 | useReducer + Context | 无 Redux/Zustand |
| 终端 | `@lydell/node-pty` + `@xterm/xterm` 6 | ConPTY 主进程托管 |
| AI | OpenAI 兼容 API | 流式 SSE + 重试退避 + token 计量（v1.22） |
| 更新 | electron-updater | GitHub Releases `latest.yml` |

运行时依赖刻意极简（react / react-dom / node-pty / xterm / electron-updater）。

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18，npm ≥ 9（Windows 构建需 Windows 环境）

### 安装与运行

```bash
git clone git@github.com:SCUT-Mida/Intelligent-ToDo.git
cd Intelligent-ToDo
npm install

npm run dev        # 开发模式（热重载）
npm run build      # 生产构建
npm run build:win  # Windows 安装包（NSIS + portable）
```

### 质量门禁（v1.22 起）

```bash
npm run typecheck  # tsc --noEmit（node + web 双配置）
npm test           # vitest 单元测试（纯逻辑模块）
npm run lint       # oxlint 静态检查
```

### 配置 AI

1. 设置 → 通用 → AI 模型：从 `~/.config/opencode/opencode.json` 自动发现的 provider/model 树中点击切换（推荐），或手工添加配置
2. API Key 仅本地加密存储；支持多配置档案切换
3. 配好后即可使用：今日优先分析 / 仓库 AI 记忆 / 会话自动标题

### 使用 Agent 对话

1. 安装任意受支持的 CLI 助手（如 `npm i -g @anthropic-ai/claude-code`）
2. Agent 对话 → 新建会话：选择 agent + 工作目录（可从仓库导航跳转）
3. 在嵌入式终端原生交互；左侧 Markdown 编辑器可撰写长 prompt 发送

---

## 📁 项目结构

```
Intelligent-ToDo/
├── src/
│   ├── main/                      # Electron 主进程（"后端"）
│   │   ├── index.ts               #   入口：窗口/托盘/更新/todo IPC
│   │   ├── aiClient.ts            #   LLM 客户端（流式/重试/usage）
│   │   ├── netFetch.ts            #   代理感知 HTTP（netFetch + netFetchStream）
│   │   ├── tokenMeter.ts          #   token 用量计量
│   │   ├── crypto.ts / logger.ts / aiConfigScanner.ts
│   │   ├── agentHub/              #   PTY 管理、agent 检测、会话持久化
│   │   └── repoNav/               #   扫描、启动器、AI 记忆、配置
│   ├── preload/index.ts           # contextBridge 白名单桥（window.api/repoNav/agentHub）
│   ├── renderer/src/
│   │   ├── AppShell.tsx           # 三应用常驻挂载 + 切换
│   │   ├── store/AppContext.tsx   # 全局 reducer + 跨应用跳转
│   │   ├── apps/{todoApp,repoNavApp,agentHubApp}/
│   │   ├── components/{Todo用,AgentHub/,RepoNav/}
│   │   ├── settings/              # 统一设置（通用/代办/仓库/Agent）
│   │   └── styles/global.css      # 主题变量 + 全部样式
│   └── shared/                    # 双进程共享类型、IPC 常量、纯逻辑
│       ├── types.ts / agentHub.ts / repoNav.ts / aiConfig.ts
│       ├── recurrence.ts / workday.ts / jsonUtils.ts
├── tests/                         # vitest 单元测试（纯逻辑模块）
├── scripts/repo-nav/              # 独立 PowerShell 7 CLI 模块（与 GUI 数据兼容）
├── docs/                          # 架构与 AI 集成文档
└── .github/workflows/release.yml  # CI/CD（tag 驱动发版）
```

---

## 📖 文档

- [架构设计](./docs/architecture.md) — 进程模型、数据流、状态管理（Todo 部分详实）
- [AI 集成说明](./docs/ai-integration.md) — 接口协议、Prompt 设计、JSON 解析策略
- [AGENTS.md](./AGENTS.md) — AI 编码助手工作约定（仓库地图 + 代码规范）

---

## 🔒 数据存储

所有用户数据保存在系统 userData 目录（Windows：`%APPDATA%\intelligent-todo\`）：

| 文件 | 内容 |
|------|------|
| `todo-data.json` | 任务、AI 配置（Key 加密）、AI 优先快照、番茄钟、节假日覆盖 |
| `agentHub-sessions.json` / `agentHub-config.json` | Agent 会话与配置（自定义 agent + 启动参数） |
| `repo-nav/index.json` / `repo-memory.json` / `config.json` / `user-data.json` | 仓库索引、AI 记忆、配置、收藏/计数 |
| `token-usage.json` | 每日 token 用量（v1.22） |
| `logs/` | 滚动日志 |

---

## 🗺️ Roadmap

- [x] ~~Agent 任务模式：结构化一次性运行（stream-json → 事件日志 → 可检索）~~（v1.23）
- [x] ~~会话全文搜索~~（v1.23）
- [x] ~~命令执行审批门~~（v1.23，dangerous/all/off 三档 + 审计日志）
- [ ] 后台任务 + 托盘完成通知
- [ ] Todo ↔ Agent 闭环（任务直接交给 agent 执行并回写摘要）
- [ ] MCP 客户端支持（视自建 agent loop 进度）

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。提交前请确保：

- `npm run typecheck`、`npm test`、`npm run lint` 全部通过
- 不引入 `any` / `@ts-ignore` 等类型逃逸
- 纯逻辑改动请补充 `tests/` 单元测试
- 遵循现有代码风格与命名约定（详见 [AGENTS.md](./AGENTS.md)）

---

## 📄 许可证

[MIT License](./LICENSE)
