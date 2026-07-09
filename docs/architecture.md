# 架构设计 · Architecture

本文档详述 智能化代办 应用的进程模型、数据流、状态管理与核心设计决策。

---

## 1. 进程模型

应用基于 Electron，遵循标准的**三进程隔离架构**：

```
┌─────────────────────────────────────────────────────────┐
│  Main Process (Node.js 环境)                             │
│  src/main/index.ts                                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │ • 文件读写（todo-data.json 持久化）                │   │
│  │ • API Key 加密 / 解密（safeStorage / DPAPI）       │   │
│  │ • AI HTTP 请求（fetch → OpenAI 兼容接口）          │   │
│  │ • IPC 处理器（data:load, data:save, ai:recommend） │   │
│  │ • 数据损坏恢复 + 自动备份                          │   │
│  └──────────────────────────────────────────────────┘   │
              ▲  IPC (contextBridge)  ▲                     │
┌────────────┼──────────────────────┼─────────────────────┐
│  Preload (src/preload/index.ts) — 安全桥接层              │
│  暴露受限的 window.api 对象，无 Node 能力泄露             │
└────────────┼──────────────────────┼─────────────────────┘
              ▼                      ▼
┌─────────────────────────────────────────────────────────┐
│  Renderer Process (浏览器环境)                           │
│  src/renderer/src/                                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │ • React 18 UI 组件树                              │   │
│  │ • 状态管理（useState + useEffect）                │   │
│  │ • 通过 window.api 调用主进程能力                   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 安全边界
- `contextIsolation: true` — 渲染进程无法直接访问 Node API
- `nodeIntegration: false` — 无 Node 暴露
- `sandbox: false`（preload 需 IPC），但通过 `contextBridge` 严格限定暴露接口
- 所有文件/网络操作只在主进程发生，渲染进程只能通过白名单 IPC 调用

---

## 2. 数据流

### 2.1 持久化数据流

```
渲染进程 state 变化
    │
    ▼ useEffect([data])
window.api.saveData(data)  ──IPC──▶  主进程 saveData()
    │                                       │
    │                                  加密 apiKey
    │                                       │
    │                                  writeFileSync
    │                                       ▼
    │                              userData/todo-data.json
    │
    ▼ 启动时
window.api.loadData()  ──IPC──▶  主进程 loadData()
    │                                       │
    │                                  读取 + 解析 JSON
    │                                  解密 apiKey
    │                                  （损坏则备份+重置）
    │                                       ▼
    └─────── LoadResult { data, ok, error? }
```

**关键设计**：渲染进程持有单一 `AppData` 状态对象，每次变化都全量持久化。这带来了「总是保存」的可靠性，代价是写入频率。对于桌面单用户场景完全可接受。

### 2.2 AI 分析数据流

```
用户点击「开始智能分析」
    │
    ▼ handleAiRegenerate()
window.api.aiRecommend(tasks, config) ──IPC──▶ 主进程 aiRecommend()
    │                                               │
    │                                          过滤未完成任务
    │                                          构造 Prompt（含 task ID）
    │                                          fetch → /chat/completions
    │                                          解析 JSON（容错）
    │                                               ▼
    └─────── AiPriorityResult { items, summary }
    │
    ▼ 转换为 DailyPriority 存入 data.priorities
触发 useEffect 自动持久化
```

---

## 3. 状态管理

应用**不使用** Redux/Zustand 等状态库，全部基于 React 内置 `useState` + `useCallback`。对于此规模的单窗口应用，这足够清晰。

### 3.1 App.tsx 顶层状态

```typescript
const [data, setData] = useState<AppData>(...)   // 唯一数据源
const [loaded, setLoaded] = useState(false)       // 初始加载标志
const [loadError, setLoadError] = useState(...)   // 加载错误
const [taskModal, setTaskModal] = useState(...)   // 任务编辑弹窗
const [configOpen, setConfigOpen] = useState(...) // AI 配置弹窗
const [view, setView] = useState<'board'|'priority'>('board')  // 视图切换
const [aiState, setAiState] = useState<AiState>({kind:'idle'}) // AI 调用状态
```

### 3.2 派生数据

```typescript
const todayPriority = data.priorities?.find(p => p.date === today) ?? null
const history = data.priorities?.filter(p => p.date !== today).sort(...)
const incompleteCount = data.tasks.filter(t => !t.completed).length
```

### 3.3 同步规则（核心设计）

任务（Task）与今日优先项（PriorityItem）之间存在**双向同步**：

| 触发动作 | Task 变化 | PriorityItem 变化 |
|---------|-----------|-------------------|
| 看板勾选任务 | `completed` 翻转 | 同步 `completed`，完成时进度→100 |
| 优先项打钩 | `completed` 翻转 | 同步 `completed`，进度→100 |
| 优先项进度=100% | `completed`→true | `completed`→true，进度=100 |
| 优先项进度<100% | 不变 | 仅更新 `progress` |

这确保两个视图永远一致——无论用户从哪边操作。

---

## 4. 组件层次

```
App
├── toolbar
│   ├── toolbar__tabs (任务看板 / 今日优先)
│   ├── 新建任务按钮
│   ├── 导出按钮
│   └── ⚙ 配置按钮
│
├── [view === 'board']
│   └── QuadrantBoard           ← 完整四象限看板
│       └── 4× quadrant
│           └── task cards
│
├── [view === 'priority']
│   └── TodayPriorityView       ← 今日优先工作台
│       ├── priority-view__left
│       │   └── QuadrantBoard compact   ← 紧凑看板
│       └── priority-view__right
│           └── priority-panel
│               ├── 今日 tab → TodayTab
│               │   ├── summary banner
│               │   └── priority-item × N
│               │       └── ProgressSteps
│               └── 历史 tab → HistoryTab
│                   └── priority-history__item × N
│
├── TaskModal (条件渲染)
└── ConfigModal (条件渲染)
```

### QuadrantBoard 的复用
`QuadrantBoard` 通过 `compact` prop 同时服务两个场景：
- `compact={false}`（默认）：完整看板，带添加/编辑/删除按钮
- `compact={true}`：紧凑模式，隐藏操作按钮，间距更密，用于今日优先视图左侧

---

## 5. 类型系统

所有共享类型集中在 `src/shared/types.ts`，主进程与渲染进程共用：

```typescript
interface Task { id, content, quadrant, dueDate, completed, createdAt, updatedAt }
interface PriorityItem { taskId, reason, progress, completed, completedAt }
interface DailyPriority { date, items, summary, createdAt, updatedAt }
interface AppData { tasks, config, priorities? }   // priorities 可选，向后兼容
interface AiPriorityResult { items: [{taskId, reason}], summary, raw? }
interface AppConfig { apiUrl, apiKey, model }
```

**向后兼容设计**：`priorities` 字段是可选的，旧数据文件（没有此字段）加载时自动补 `[]`，确保升级无破坏。

---

## 6. 错误处理策略

| 场景 | 处理 |
|------|------|
| 数据文件不存在 | 视为首次启动，返回默认空数据 |
| 数据文件损坏 | 备份原文件 → 写入默认值 → 提示用户 |
| AI Key 未配置 | 抛错，UI 显示明确提示 |
| AI 请求超时 | 60 秒 AbortController，提示检查网络 |
| AI 返回非 JSON | 容错解析：提取 `{...}` 段；失败则把原文作为 summary，items 为空 |
| AI 返回无效 taskId | 过滤掉不匹配的项，只保留真实任务 |
| 任务被删除后优先项仍引用 | 显示「（原任务已删除）」优雅降级 |

---

## 7. 性能考量

- **全量持久化**：每次 state 变化写文件。单用户桌面场景下 I/O 可忽略，换取「永不丢失」的可靠性。
- **CSS 变量主题**：所有颜色/圆角/阴影通过 `:root` 变量定义，主题切换无需重渲染。
- **派生数据计算在渲染时**：`todayPriority`/`history` 每次渲染重算，但数据量小（单日条目有限），无性能问题。
- **零运行时 UI 库**：避免 Material-UI/Antd 等大包，首屏快。

---

## 8. 扩展点

当前架构为未来扩展留有余地：
- **多日规划**：`DailyPriority` 按 `date` 索引，可扩展为周/月视图
- **主题切换**：CSS 变量已就位，添加 dark mode 只需覆盖 `:root`
- **多设备同步**：持久化层隔离在主进程，可替换为云同步而不动 UI
- **更多 AI 能力**：`ai:recommend` IPC 通道可复用，新增 `ai:decompose`（任务拆解）等
