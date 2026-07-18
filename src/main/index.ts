import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from 'fs'
import { autoUpdater } from 'electron-updater'
import type { AppData, Task, AppConfig, LoadResult, AiPriorityResult, YearHolidayData } from '../shared/types'
import { getDayInfo, describeDay, WEEKDAYS_ZH, remainingWorkdays } from '../shared/workday'
import { createDefaultData } from '../shared/types'
import { registerRepoNavIpc } from './repoNav'
import { scanAiConfigs } from './aiConfigScanner'
import { AI_IPC } from '../shared/aiConfig'
import { logger } from './logger'
import { netFetch } from './netFetch'
import type { NetResponse } from './netFetch'
import { ENC_PREFIX, encryptApiKey, decryptApiKey } from './crypto'

// ── Single-instance lock + GPU cache cleanup ───────────────────────────────
// Prevents Windows error "Unable to move the cache: 拒绝访问 (0x5)" at startup.
// Root causes:
//   (a) A second app instance tries to share the same GPUCache directory.
//   (b) A previous instance crashed and left stale lock files in GPUCache.
// Fixes:
//   (a) Enforce single instance — second launch focuses the existing window.
//   (b) Wipe GPUCache before app ready; Electron recreates it cleanly.

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  // Another instance already holds the lock — exit silently.
  app.quit()
}

app.on('second-instance', () => {
  // User launched us again — focus the existing window instead of starting.
  const wins = BrowserWindow.getAllWindows()
  if (wins.length > 0) {
    if (wins[0].isMinimized()) wins[0].restore()
    wins[0].focus()
  }
})

// Wipe stale GPU cache before app ready. GPUCache only holds shader
// compilations and font cache — no user data lost. Electron recreates it.
try {
  const gpuCachePath = join(app.getPath('userData'), 'GPUCache')
  rmSync(gpuCachePath, { recursive: true, force: true })
} catch {
  // Ignore — directory may not exist on first run or be inaccessible.
}

const DATA_FILE = join(app.getPath('userData'), 'todo-data.json')

// ── Proxy-aware HTTP via Electron's net module ──────────────────────────────
// The netFetch function is now in ./netFetch.ts, imported above.
// The encryptApiKey/decryptApiKey functions are now in ./crypto.ts, imported above.

function loadData(): LoadResult {
  // First launch — no file yet, this is a normal empty start.
  if (!existsSync(DATA_FILE)) {
    return { data: createDefaultData(), ok: true }
  }
  try {
    const raw = readFileSync(DATA_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppData>
    const defaults = createDefaultData()
    const config = { ...defaults.config, ...(parsed.config ?? {}) }
    // decrypt the API key read from disk
    config.apiKey = decryptApiKey(config.apiKey)
    return {
      ok: true,
      data: {
        // Spread parsed FIRST so optional fields (priorities, pomodoro,
        // holidayOverrides, and any future ones) round-trip to disk. Earlier
        // this reconstructed only {tasks, config}, which silently dropped the
        // AI priority snapshots, pomodoro count, and holiday overrides on every
        // restart — analyses "disappeared" even though they were saved.
        ...parsed,
        // Normalize legacy tasks that predate the `progress` field → default 0.
        tasks: Array.isArray(parsed.tasks)
          ? (parsed.tasks as Task[]).map((t) => ({ ...t, progress: t.progress ?? 0 }))
          : defaults.tasks,
        config
      }
    }
  } catch (err) {
    // File exists but is corrupted/unreadable. Back it up BEFORE returning defaults
    // so the original data is preserved for manual recovery, then write valid
    // defaults to the main file so subsequent launches are clean.
    console.error('Failed to load data:', err)
    let backupPath: string | undefined
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      backupPath = `${DATA_FILE}.corrupt-${ts}`
      copyFileSync(DATA_FILE, backupPath)
      console.error(`Corrupted data backed up to: ${backupPath}`)
    } catch (backupErr) {
      console.error('Failed to back up corrupted file:', backupErr)
      backupPath = undefined
    }
    // Write valid defaults so the main file is no longer corrupted.
    const defaults = createDefaultData()
    try {
      writeFileSync(
        DATA_FILE,
        JSON.stringify(
          { ...defaults, config: { ...defaults.config, apiKey: encryptApiKey('') } },
          null,
          2
        ),
        'utf-8'
      )
    } catch (writeErr) {
      console.error('Failed to write defaults after corruption:', writeErr)
    }
    const message = err instanceof Error ? err.message : String(err)
    return {
      data: defaults,
      ok: false,
      error: `数据文件损坏，已重置为空。原始文件已备份。(${message})`,
      backupPath
    }
  }
}

function saveData(data: AppData): void {
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    // encrypt the API key before writing to disk (don't mutate the input)
    const onDisk: AppData = {
      ...data,
      config: { ...data.config, apiKey: encryptApiKey(data.config.apiKey) }
    }
    writeFileSync(DATA_FILE, JSON.stringify(onDisk, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save data:', err)
    throw err
  }
}

/**
 * Extract a JSON object from an LLM response that may be wrapped in markdown
 * code fences or surrounded by prose. Returns the parsed value or null.
 */
function extractJson(content: string): unknown | null {
  if (!content) return null
  // Strip markdown code fences ```json ... ``` or ``` ... ```
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1] : content
  // Find the first '{' and matching last '}'
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const slice = candidate.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch {
    return null
  }
}

/**
 * Build the prompt and call an OpenAI-compatible chat completions endpoint.
 * Returns a structured AiPriorityResult with task references + summary.
 */
async function aiRecommend(
  tasks: Task[],
  config: AppConfig,
  holidayOverrides?: Record<number, YearHolidayData>,
  opts?: { companyLastSaturday?: boolean }
): Promise<AiPriorityResult> {
  if (!config.apiUrl || !config.apiKey || !config.model) {
    throw new Error('请先在配置页面填写完整的 AI 配置（URL、Key、Model）')
  }

  const baseUrl = config.apiUrl.replace(/\/+$/, '')
  const url = `${baseUrl}/chat/completions`

  const incomplete = tasks.filter((t) => !t.completed)
  if (incomplete.length === 0) {
    throw new Error('当前没有待办任务，请先添加任务后再使用 AI 智能分配')
  }

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  // Today's workday status, so the AI knows whether today is a working day,
  // a holiday, a 调休补班, or the company's last-Saturday workday.
  const todayInfo = getDayInfo(today, holidayOverrides, opts)
  const todayDesc = `${todayStr} ${WEEKDAYS_ZH[today.getDay()]}（${describeDay(todayInfo)}）`

  const quadrantName: Record<string, string> = {
    q1: '重要·紧急',
    q2: '重要·不紧急',
    q3: '不重要·紧急',
    q4: '不重要·不紧急'
  }

  const taskList = incomplete
    .map((t, i) => {
      // Annotate each due date with its workday status + remaining workdays,
      // and include the task's progress, so the AI can reason accurately.
      let due = '，无截止日期'
      if (t.dueDate) {
        const parts = t.dueDate.split('-').map(Number)
        const dueDate = new Date(parts[0], parts[1] - 1, parts[2])
        const dueInfo = getDayInfo(dueDate, holidayOverrides, opts)
        const left = remainingWorkdays(today, dueDate, holidayOverrides, opts)
        due = `，截止：${t.dueDate} ${WEEKDAYS_ZH[dueDate.getDay()]}（${describeDay(dueInfo)}），距今天剩余 ${left} 个工作日`
      }
      const progress = `进度：${t.progress ?? 0}%`
      return `${i + 1}. [ID: ${t.id}] [${quadrantName[t.quadrant] ?? t.quadrant}] ${t.content}（${progress}）${due}`
    })
    .join('\n')

  const systemPrompt =
    '你是一个专业的个人任务管理助手。你熟悉艾森豪威尔矩阵（四象限法则）。' +
    '你的任务是根据用户的待办事项列表，结合任务进度、截止日期、中国法定节假日与调休补班规则，智能推荐今日应该优先完成的任务。' +
    '你必须严格以 JSON 格式返回结果，不要包含 markdown 代码块标记或多余说明。'

  const userPrompt =
    `今天是 ${todayDesc}。\n` +
    '工作日规则：法定节假日和普通周末不计为可工作日；调休补班日（周末调休为工作日）和每月最后一个周六（贵司规则）计为工作日。' +
    '若某任务截止日落在节假日或周末，应建议提前到节前最近的工作日完成；若今天本身是节假日或周末，应在行动建议中提醒，并酌情减少推荐量或建议休息。\n\n' +
    `以下是我的未完成待办任务列表（含进度与截止信息）：\n\n${taskList}\n\n` +
    '请综合四象限法则、任务进度、截止日期与剩余工作日，推荐我今日应该优先完成的 3-5 个任务，并按优先级从高到低排序。\n' +
    '进度越低的任务通常越需要尽快推进；接近完成（75%+）的任务可优先收尾。\n\n' +
    '推荐理由格式规范（必须严格遵守）：\n' +
    '  有截止日期：「截止日期是 yyyy-mm-dd 周x（剩余 N 工作日）— 其他理由说明」\n' +
    '  无截止日期：「无截止日期 — 其他理由说明」\n' +
    '其中 yyyy-mm-dd、周x、N 直接使用上面任务列表里给出的值，不要自行计算或编造。「其他理由说明」结合进度、重要紧急程度、是否需在节前完成等，一句话即可。\n\n' +
    '请严格以 JSON 格式返回（不要包含 markdown 代码块标记，不要有多余说明文字），格式如下：\n' +
    '{\n' +
    '  "items": [\n' +
    '    { "taskId": "<必须使用上面列表中的任务 ID>", "reason": "<按上述格式的推荐理由>" }\n' +
    '  ],\n' +
    '  "summary": "<今日整体行动建议，一句话>"\n' +
    '}\n\n' +
    '注意：taskId 字段必须精确匹配上方任务列表中 [ID: xxx] 的值，不要编造 ID。'

  // Timeout the request so a hung API endpoint can't freeze the UI forever.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)
  let resp: NetResponse
  try {
    resp = await netFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.6,
        stream: false
      }),
      signal: controller.signal
    })
  } catch (fetchErr) {
    clearTimeout(timeout)
    if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
      throw new Error('AI 请求超时（60 秒未响应），请检查网络或更换模型。')
    }
    throw new Error(`AI 请求失败：${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`)
  }
  clearTimeout(timeout)

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`AI 请求失败 (${resp.status}): ${text.slice(0, 300)}`)
  }

  const json = (await resp.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = json.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('AI 返回内容为空')
  }

  // Parse structured JSON; fall back gracefully if the model ignored the format.
  const validTaskIds = new Set(incomplete.map((t) => t.id))
  const parsed = extractJson(content)

  if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { items?: unknown }).items)
  ) {
    const obj = parsed as {
      items?: Array<{ taskId?: unknown; reason?: unknown }>
      summary?: unknown
    }
    const items = (obj.items ?? [])
      .filter(
        (it) =>
          it &&
          typeof it === 'object' &&
          typeof (it as { taskId?: unknown }).taskId === 'string' &&
          typeof (it as { reason?: unknown }).reason === 'string'
      )
      .map((it) => ({
        taskId: (it as { taskId: string }).taskId,
        reason: (it as { reason: string }).reason
      }))
      // Only keep items whose taskId matches a real task
      .filter((it) => validTaskIds.has(it.taskId))
    const summary =
      typeof obj.summary === 'string' && obj.summary.trim()
        ? obj.summary.trim()
        : ''
    return {
      items,
      summary: summary || '今日优先任务已生成，请按推荐顺序执行。',
      raw: content
    }
  }

  // Fallback: AI didn't return valid JSON. Surface raw text as the summary.
  return {
    items: [],
    summary: content.trim().slice(0, 500) || 'AI 返回内容无法解析',
    raw: content
  }
}

/** Parse the NateScarlet/holiday-cn dataset (served via jsdelivr CDN). */
function parseNateScarlet(json: unknown): YearHolidayData {
  const data = json as { days?: Array<{ name?: unknown; date?: unknown; isOffDay?: unknown }> }
  if (!data || !Array.isArray(data.days)) throw new Error('数据格式异常')
  const holidays: Record<string, string> = {}
  const adjustedWorkdays: Record<string, true> = {}
  for (const d of data.days) {
    if (typeof d.date !== 'string') continue
    if (d.isOffDay === true) {
      holidays[d.date] = typeof d.name === 'string' ? d.name : '节假日'
    } else if (d.isOffDay === false) {
      adjustedWorkdays[d.date] = true
    }
  }
  return { holidays, adjustedWorkdays }
}

/** Parse the timor.tech year response. */
function parseTimor(json: unknown): YearHolidayData {
  const data = json as {
    code?: number
    holiday?: Record<string, { holiday?: unknown; name?: unknown; date?: unknown }>
  }
  if (data.code !== 0 || !data.holiday) throw new Error('数据格式异常')
  const holidays: Record<string, string> = {}
  const adjustedWorkdays: Record<string, true> = {}
  for (const info of Object.values(data.holiday)) {
    const iso = typeof info.date === 'string' ? info.date : undefined
    if (!iso) continue
    if (info.holiday === true) {
      holidays[iso] = typeof info.name === 'string' ? info.name : '节假日'
    } else if (info.holiday === false) {
      adjustedWorkdays[iso] = true
    }
  }
  return { holidays, adjustedWorkdays }
}

interface HolidaySource {
  name: string
  url: string
  parse: (json: unknown) => YearHolidayData
}

/**
 * Fetch a year's official Chinese holiday + 调休补班 data.
 *
 * Tries multiple sources in order so a single flaky/blocked endpoint doesn't
 * break the in-app updater (timor.tech alone proved unreachable on some user
 * networks). Primary is the jsdelivr CDN mirror of NateScarlet/holiday-cn —
 * CDN-backed, reliable in China; timor.tech is the fallback.
 *
 * Returns the first source that succeeds; collects per-source errors so the
 * final failure message explains what was tried.
 */
async function fetchHolidays(year: number): Promise<YearHolidayData> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('年份不合法')
  }

  const sources: HolidaySource[] = [
    {
      name: 'jsdelivr CDN',
      url: `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
      parse: parseNateScarlet
    },
    {
      name: 'timor.tech',
      url: `https://timor.tech/api/holiday/year/${year}`,
      parse: parseTimor
    },
    {
      name: 'jsdelivr Fastly 镜像',
      url: `https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
      parse: parseNateScarlet
    }
  ]

  const errors: string[] = []
  for (const src of sources) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 12000)
      let resp: NetResponse
      try {
        resp = await netFetch(src.url, { signal: controller.signal })
      } catch (fetchErr) {
        const isAbort = fetchErr instanceof Error && fetchErr.name === 'AbortError'
        errors.push(`${src.name}：${isAbort ? '请求超时' : '无法访问'}`)
        continue
      } finally {
        clearTimeout(timeout)
      }
      if (resp.status === 404) {
        errors.push(`${src.name}：该年份尚未发布`)
        continue
      }
      if (!resp.ok) {
        errors.push(`${src.name}：HTTP ${resp.status}`)
        continue
      }
      const json = await resp.json()
      const parsed = src.parse(json)
      // A valid-but-empty dataset means the year exists in the repo but hasn't
      // been announced yet (e.g. 2027 before the State Council publishes).
      // Treat as "not published" and try the next source rather than saving
      // an empty holiday year that would erase all holidays.
      if (
        Object.keys(parsed.holidays).length === 0 &&
        Object.keys(parsed.adjustedWorkdays).length === 0
      ) {
        errors.push(`${src.name}：该年份尚未发布`)
        continue
      }
      return parsed
    } catch (e) {
      errors.push(`${src.name}：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(
    `所有节假日数据源均失败，可能是网络问题或该年份尚未发布。已尝试：\n${errors.join('；\n')}`
  )
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: '本地AI工具合集',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  // Register global exception handlers FIRST, before any other code runs,
  // so even errors during logger initialization get captured.
  process.on('uncaughtException', (err) => {
    try {
      console.error(`[FATAL] uncaughtException: ${err.name}: ${err.message}\n${err.stack ?? ''}`)
    } catch { /* ignore */ }
    // Also try to write to the log file directly — logger may or may not be
    // initialized at this point, so guard with try/catch.
    try {
      const { appendFileSync } = require('fs') as typeof import('fs')
      const { join } = require('path') as typeof import('path')
      const { app: app2 } = require('electron')
      const logPath = join(app2.getPath('userData'), 'logs', `app-${new Date().toISOString().slice(0, 10)}.log`)
      const line = `${new Date().toISOString()} [FATAL] [process] uncaughtException ${JSON.stringify({ name: err.name, message: err.message, stack: err.stack })}\n`
      appendFileSync(logPath, line, 'utf-8')
    } catch { /* nothing more we can do */ }
  })
  process.on('unhandledRejection', (reason) => {
    const meta = reason instanceof Error
      ? { name: reason.name, message: reason.message, stack: reason.stack }
      : { reason: String(reason) }
    try {
      console.error(`[FATAL] unhandledRejection: ${JSON.stringify(meta)}`)
    } catch { /* ignore */ }
  })

  // Initialize file-based logger.
  logger.initialize()
  logger.info('app', 'starting', {
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    electron: process.versions.electron
  })
  logger.info('app', 'step 1: about to register repo nav IPC')

  // Register repo-navigator IPC handlers (before data handlers — ordering
  // doesn't matter for IPC, but grouping them together reads well).
  registerRepoNavIpc(ipcMain)
  logger.info('app', 'step 2: repo nav IPC registered')

  // Scan external AI tool configs (opencode.json) so the renderer can offer
  // a "import from existing config" option in settings.
  ipcMain.handle(AI_IPC.SCAN_CONFIGS, () => scanAiConfigs())

  // Return the current log file path so the UI can show it in error messages.
  ipcMain.handle('app:getLogPath', () => logger.currentLogFilePath())
  logger.info('app', 'step 3: misc IPC registered')

  ipcMain.handle('data:load', () => loadData())
  logger.info('app', 'step 4: data:load registered')
  ipcMain.handle('data:save', (_e, data: AppData) => {
    saveData(data)
    return true
  })
  ipcMain.handle(
    'ai:recommend',
    (
      _e,
      tasks: Task[],
      config: AppConfig,
      holidayOverrides?: Record<number, YearHolidayData>,
      opts?: { companyLastSaturday?: boolean }
    ) => aiRecommend(tasks, config, holidayOverrides, opts)
  )
  ipcMain.handle('holidays:fetch', (_e, year: number) => fetchHolidays(year))
  ipcMain.handle(
    'md:export',
    async (_e, content: string, defaultName: string) => {
      const result = await dialog.showSaveDialog({
        title: '导出 Markdown',
        defaultPath: defaultName,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (result.canceled || !result.filePath) {
        return false
      }
      writeFileSync(result.filePath, content, 'utf-8')
      return true
    }
  )

  createWindow()
  logger.info('app', 'step 5: createWindow returned')

  // ---- auto-update (electron-updater) ----
  // Don't auto-download; let the user confirm in Settings. Update events are
  // forwarded to the renderer so the Settings panel can show live status.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  logger.info('app', 'step 6: autoUpdater configured')
  const updaterWindow = BrowserWindow.getAllWindows()[0]
  const send = (payload: unknown): void => {
    if (updaterWindow && !updaterWindow.isDestroyed()) {
      updaterWindow.webContents.send('update:event', payload)
    }
  }
  autoUpdater.on('checking-for-update', () => send({ stage: 'checking' }))
  autoUpdater.on('update-available', (info: { version?: string; releaseNotes?: unknown }) => {
    const rawNotes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((r) => (typeof r === 'string' ? r : '')).join('\n')
        : ''
    // Strip HTML tags that electron-updater may inject (e.g. <p>, <br>, <strong>)
    const notes = rawNotes
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    send({ stage: 'available', version: info.version ?? '', notes })
  })
  autoUpdater.on('update-not-available', () => send({ stage: 'latest' }))
  autoUpdater.on('download-progress', (p) => send({ stage: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', () => send({ stage: 'downloaded' }))
  autoUpdater.on('error', (err) => send({ stage: 'error', message: err?.message ?? String(err) }))

  // Current version + packaged flag, for the Settings panel.
  ipcMain.on('app:status', (e) => {
    e.returnValue = { version: app.getVersion(), isPackaged: app.isPackaged }
  })
  ipcMain.handle('update:check', () => {
    if (!app.isPackaged) {
      send({ stage: 'error', message: '当前为开发/未打包模式，自动更新不可用。请使用安装版体验。' })
      return false
    }
    autoUpdater.checkForUpdates().catch((err) => send({ stage: 'error', message: err?.message ?? String(err) }))
    return true
  })
  ipcMain.handle('update:download', () => {
    autoUpdater.downloadUpdate().catch((err) => send({ stage: 'error', message: err?.message ?? String(err) }))
    return true
  })
  ipcMain.handle('update:install', () => {
    // quitAndInstall closes the app and runs the downloaded NSIS installer,
    // which silently replaces the installed version, then relaunches.
    autoUpdater.quitAndInstall()
    return true
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  logger.info('app', 'window-all-closed fired', { platform: process.platform })
  if (process.platform !== 'darwin') {
    logger.info('app', 'calling app.quit()')
    app.quit()
  }
})

process.on('exit', (code) => {
  try {
    console.error(`[FATAL] process exit code=${code}`)
  } catch { /* ignore */ }
})
