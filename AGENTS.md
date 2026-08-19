# AGENTS.md — AI 编码助手工作约定

面向在本仓库工作的 AI 编码助手（Claude Code / OpenCode / 其他）与人类贡献者。
目标：让任何 agent 不读全仓库也能安全、一致地改代码。

## 仓库地图

四合一 Electron 桌面套件（产品名「本地AI工具集」，仅 Windows 发行）：

| 子应用 | 主进程 | 渲染进程 |
|--------|--------|----------|
| 智能代办 todo | `src/main/index.ts`（todo IPC + aiRecommend） | `src/renderer/src/apps/todoApp/`、`components/*`（QuadrantBoard 等） |
| 仓库导航 repoNav | `src/main/repoNav/`（scanner/launcher/aiMemory/config/userData） | `apps/repoNavApp/`、`components/RepoNav/` |
| Agent 对话 agentHub | `src/main/agentHub/`（pty/detect/args/agentConfig/persistence/taskRunner） | `apps/agentHubApp/`、`components/AgentHub/` |
| API 调试 apiTool | `src/main/apiTool/`（netFetch 执行 + api-tool.json 持久化） | `apps/apiToolApp/`、`components/ApiTool/` |

关键横切模块：

- `src/preload/index.ts` — contextBridge 白名单桥；**所有新 IPC 必须在这里加包装**
- `src/shared/` — 双进程共享类型与常量；**IPC channel 名一律集中定义在此**（`agentHub.ts` 的 `AGENT_IPC`/`TASK_IPC`、`repoNav.ts` 的 `IPC`/`IPC_V2`），主进程与 preload 都从这 import，禁止裸写字符串
- `src/main/aiClient.ts` — 唯一的 LLM 客户端（OpenAI 兼容；流式 SSE、429/5xx 退避重试、usage 提取）。**新功能调 LLM 一律走 `callLLM`**，并传 `usageSource` 计量
- `src/main/netFetch.ts` — 代理感知 HTTP（Electron net；系统代理生效）。**禁止直接用 Node fetch/undici**
- `src/main/tokenMeter.ts` — token 用量计量（按日/按来源）
- `src/main/notify.ts` — 主进程通知总线；功能模块经 `notifyBus.fire()` 发系统通知，OS 层面（Notification/托盘气球）只在 `main/index.ts` 接线
- `src/main/atomic.ts` — 原子写 JSON（tmp+rename）+ 损坏备份读取；**新的 JSON 持久化一律用它**
- `src/main/agentHub/taskRunner.ts` + `eventLog.ts` + `streamJson.ts` — 结构化任务模式（非 PTY 一次性运行、JSONL 事件日志、Claude stream-json 解析）
- `src/main/logger.ts` — 滚动日志；主进程日志一律走 logger，不裸 console
- `scripts/repo-nav/` — 独立 PowerShell 模块，与 GUI 共享 index.json 数据格式（改动扫描/索引格式时需双向兼容）

## 进程与数据流

- 经典三进程：main（全部"后端"逻辑 + 持久化）→ preload（白名单桥）→ renderer（React）
- 渲染进程四应用**常驻挂载**（AppShell 用 display:none 切换）——这是嵌入式 PTY 会话存活的前提，**不要改成卸载式切换**
- 持久化全部在 main、全部 userData 目录：损坏时先备份（`.corrupt-<ts>`）再回落默认；写盘用原子写（tmp + rename）
- API Key 经 `src/main/crypto.ts`（safeStorage/DPAPI）加密后落盘；**任何日志/IPC 不得输出明文 Key**

## 命令

```bash
npm run dev        # 开发（electron-vite HMR）
npm run typecheck  # tsc --noEmit 双配置 —— 提交前必须通过
npm test           # vitest 单元测试（tests/）
npm run lint       # oxlint（存量 warning 容忍，error 必须为 0）
npm run build:win  # 构建安装包
```

## 代码规范

1. **零 `any` / 零 `@ts-ignore`**：类型逃逸一律拒绝；跨 IPC 的 payload 类型定义在 `src/shared/`
2. **IPC 三件套**：新通道 = shared 常量 + main handler + preload 包装，缺一不可；main→renderer 推送参照 `repoNav:scanProgress`（sender.send + preload 返回退订函数）
3. **纯逻辑下沉 shared**：不依赖 Electron 的逻辑（如 `recurrence.ts`、`workday.ts`、`jsonUtils.ts`）放 `src/shared/`，并在 `tests/` 配单测；import 了 electron 的模块不进单测
4. **CSS**：BEM 命名（`.block__element--modifier`），主题变量用 `styles/global.css` 的 `:root` token，不写死颜色
5. **错误消息中文**、面向用户可行动；LLM 相关错误参照 `classifyLlmError` 分类
6. **注释风格**：模块头部块注释说明职责与架构；导出函数带用途/参数/异常说明（现有代码即范例）
7. **测试哲学**：只测真实代码路径；mock 仅限 LLM/网络边界；不为覆盖率写空转测试

## 发版

- 版本以 **git tag 为准**（CI 用 `npm version` 同步 package.json，不回写仓库）；本地 package.json 版本号随手对齐即可
- 推送 `v*` annotated tag 触发 GitHub Actions 构建 + Release；**tag message 即发行说明**
- tag 含 `-` 视为 prerelease

## 已知坑（改动前必读）

- 打包后 PATH 被净化：一切外部命令解析必须走 `agentHub/pty.ts` 的 `buildSpawnTarget` / `repoNav/which.ts`（where.exe + 已知 bin 目录兜底），不要假设 PATH 可用
- node-pty 在 Windows 需要绝对 node.exe 路径（CreateProcess 不搜 PATH）
- `Menu.setApplicationMenu(null)` 不能恢复：默认菜单的 Ctrl+V 会破坏 xterm 粘贴（见 `src/main/index.ts` 注释）
- 隐藏面板时 xterm fit 会得到 0 尺寸并使 TUI agent 崩溃（exit code 3），ResizeObserver 已过滤
- `TodayPriorityView`/`AgentHubApp` 等用 ref 镜像 state 供回调读取最新值——新增回调请沿用该模式，避免闭包过期
