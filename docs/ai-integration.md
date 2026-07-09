# AI 集成说明 · AI Integration

本文档详述 智能化代办 应用与 AI（大语言模型）的集成方式：接口协议、Prompt 设计、JSON 容错解析策略。

---

## 1. 接口协议

应用兼容任何**遵循 OpenAI Chat Completions 协议**的接口：

```
POST {apiUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "model": "{model}",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.6,
  "stream": false
}
```

### 已测试兼容的接口
- ✅ OpenAI（`gpt-4o-mini`、`gpt-4o`）
- ✅ DeepSeek（`deepseek-chat`）
- ✅ 任何 OpenAI 协议兼容的自建/第三方服务

### 配置位置
工具栏 ⚙ → 填写 API 地址、Key、模型名。Key 通过 `safeStorage` 加密存储（Windows 用 DPAPI）。

---

## 2. Prompt 设计

### 2.1 System Prompt

```
你是一个专业的个人任务管理助手。你熟悉艾森豪威尔矩阵（四象限法则）。
你的任务是根据用户的待办事项列表，智能推荐今日应该优先完成的任务。
你必须严格以 JSON 格式返回结果，不要包含 markdown 代码块标记或多余说明。
```

**设计要点**：
- 明确角色定位（专业 + 四象限专家）
- 强调输出格式约束（JSON，无 markdown，无多余文字）

### 2.2 User Prompt（动态构造）

```
今天是 2026-07-09。以下是我的未完成待办任务列表：

1. [ID: a1b2c3d4] [重要·紧急] 完成季度报告，截止日期：2026-07-10
2. [ID: e5f6g7h8] [重要·不紧急] 学习 Rust 基础，无截止日期
3. [ID: i9j0k1l2] [不重要·紧急] 回复非重要邮件，截止日期：2026-07-09
...

请根据四象限法则和截止日期，推荐我今日应该优先完成的 3-5 个任务，
并按优先级从高到低排序。对每个推荐任务，请简要说明推荐理由
（包含紧急程度、重要性、截止日期的影响）。

请严格以 JSON 格式返回（不要包含 markdown 代码块标记，不要有多余说明文字），
格式如下：
{
  "items": [
    { "taskId": "<必须使用上面列表中的任务 ID>", "reason": "<推荐理由，一句话>" }
  ],
  "summary": "<今日整体行动建议，一句话>"
}

注意：taskId 字段必须精确匹配上方任务列表中 [ID: xxx] 的值，不要编造 ID。
```

**设计要点**：
- **注入真实 task ID**：`[ID: a1b2c3d4]` 让模型引用具体任务，而不是返回模糊的任务名
- **包含日期与截止**：模型需要这些信息做优先级判断
- **示例 JSON 格式**：给出确切结构，降低格式偏差
- **强调 ID 真实性**：明确禁止编造 ID

---

## 3. 期望返回

```json
{
  "items": [
    {
      "taskId": "i9j0k1l2",
      "reason": "截止日期就是今天，虽不重要但紧急，应优先清掉以免逾期"
    },
    {
      "taskId": "a1b2c3d4",
      "reason": "重要且紧急，明天截止，今天必须推进核心章节"
    }
  ],
  "summary": "今天先快速清掉今天到期的琐事，再集中精力攻季度报告"
}
```

返回类型在 TypeScript 中定义为：

```typescript
interface AiPriorityResult {
  items: Array<{ taskId: string; reason: string }>
  summary: string
  raw?: string   // 原始返回，用于调试
}
```

---

## 4. JSON 容错解析（关键设计）

LLM 经常不严格遵守格式要求，可能出现：

| 异常情况 | 处理策略 |
|---------|---------|
| 返回纯 JSON | 直接 `JSON.parse` |
| 包裹在 ` ```json ... ``` ` 代码块 | 正则提取 fence 内容 |
| JSON 前后有解释性文字 | 定位第一个 `{` 到最后一个 `}` |
| 完全不是 JSON（纯散文） | 把原文截断作为 `summary`，`items` 为空 |
| `taskId` 不匹配任何真实任务 | 过滤掉，只保留有效项 |
| `reason` / `summary` 缺失 | 用默认文案兜底 |

### 核心解析函数

```typescript
function extractJson(content: string): unknown | null {
  if (!content) return null
  // 1. 尝试剥离 markdown 代码块
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1] : content
  // 2. 定位最外层 { ... }
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  // 3. 尝试解析
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}
```

解析后还有一层**类型守卫过滤**，确保 `items` 是数组、每项的 `taskId`/`reason` 都是字符串、且 `taskId` 在真实任务集合中。

---

## 5. 为什么用 JSON 而不是 Markdown？

早期版本让 AI 返回 markdown 文本（`## 今日推荐 1. **任务** — 理由`），仅作为问答弹窗展示。但这有两个硬伤：

1. **不可交互**：用户看到推荐后，无法直接打钩、更新进度——必须手动回到看板操作
2. **无法持久关联**：markdown 里的「任务内容」是文本，无法可靠地映射回 Task 对象（同名任务、内容变动都会失配）

改为 JSON + taskId 后：
- 每个推荐项**精确绑定到一个 Task 对象**，打钩/进度可双向同步
- 历史记录可靠——即使任务后续被编辑/删除，也能通过 ID 追溯
- UI 可以渲染成真正的待办项（checkbox + 进度条），而非死文本

---

## 6. 超时与错误处理

| 错误 | 提示文案 | 恢复方式 |
|------|---------|---------|
| 60 秒无响应 | `AI 请求超时（60 秒未响应），请检查网络或更换模型。` | 重试按钮 |
| HTTP 非 2xx | `AI 请求失败 (状态码): 响应片段` | 重试按钮 |
| 返回空内容 | `AI 返回内容为空` | 重试按钮 |
| Key 未配置 | `请先在配置页面填写完整的 AI 配置（URL、Key、Model）` | 跳转配置 |
| 无待办任务 | `当前没有待办任务，请先添加任务后再使用 AI 智能分配` | 添加任务 |

错误状态用 `aiState: { kind: 'error', message }` 表达，UI 显示红色错误条 + 重试按钮。

---

## 7. 隐私保证

- **任务数据从不离开本地**——只有当用户主动点击「智能分析」时，未完成任务的内容才会发送到配置的 AI 接口
- **API Key 加密存储**——使用操作系统级 `safeStorage`（Windows DPAPI / macOS Keychain / Linux libsecret），磁盘上是密文
- **无任何遥测**——应用不收集、不上报任何使用数据
- **用户掌控接口**——可随时更换为自建的私有 AI 服务，数据完全不经过第三方
