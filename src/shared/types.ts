// Shared types used by both main process and renderer

/** Eisenhower matrix quadrants */
export type Quadrant = 'q1' | 'q2' | 'q3' | 'q4'

/**
 * q1: 重要紧急 (Important + Urgent)     — Do First
 * q2: 重要不紧急 (Important + Not Urgent) — Schedule
 * q3: 不重要紧急 (Not Important + Urgent) — Delegate
 * q4: 不重要不紧急 (Not Important + Not Urgent) — Eliminate / Later
 */
export interface QuadrantMeta {
  id: Quadrant
  title: string
  subtitle: string
  shortLabel: string
}

export const QUADRANTS: QuadrantMeta[] = [
  {
    id: 'q1',
    title: '重要 且 紧急',
    subtitle: '立即去做',
    shortLabel: '重要·紧急'
  },
  {
    id: 'q2',
    title: '重要 不 紧急',
    subtitle: '制定计划',
    shortLabel: '重要·不紧急'
  },
  {
    id: 'q3',
    title: '不重要 但 紧急',
    subtitle: '尽量委派',
    shortLabel: '不重要·紧急'
  },
  {
    id: 'q4',
    title: '不重要 不 紧急',
    subtitle: '稍后再说',
    shortLabel: '不重要·不紧急'
  }
]

export function getQuadrantMeta(id: Quadrant): QuadrantMeta {
  return QUADRANTS.find((q) => q.id === id) ?? QUADRANTS[0]
}

/** A single todo task */
export interface Task {
  id: string
  content: string
  quadrant: Quadrant
  /** ISO date string (yyyy-mm-dd) or null */
  dueDate: string | null
  completed: boolean
  /** Completion progress 0-100, stepped by 25 (0, 25, 50, 75, 100). Source of truth — synced with priority items. */
  progress: number
  /** Recurrence pattern. Undefined = one-time task (单次). */
  recurrence?: TaskRecurrence
  /** ISO datetime string */
  createdAt: string
  /** ISO datetime string */
  updatedAt: string
}

/** Recurrence pattern for recurring tasks. */
export interface TaskRecurrence {
  type: 'weekly' | 'monthly' | 'yearly'
  /** Weekly only: selected weekdays (0=Sun, 1=Mon, ..., 6=Sat) */
  weekdays?: number[]
  /** Monthly only: day of month (1-31) */
  monthDay?: number
  /** Yearly only: month (1-12) */
  yearMonth?: number
  /** Yearly only: day of month (1-31) */
  yearDay?: number
}

/** AI model configuration (OpenAI-compatible) */
export interface AppConfig {
  /** Base URL, e.g. https://api.openai.com/v1 */
  apiUrl: string
  apiKey: string
  model: string
}

/** Full persisted app data */
export interface AppData {
  tasks: Task[]
  config: AppConfig
  /** Daily AI priority snapshots. Optional for backward compatibility with old data files. */
  priorities?: DailyPriority[]
  /** Pomodoro counter; resets daily. Optional for backward compatibility. */
  pomodoro?: PomodoroState
  /** User-fetched holiday data, keyed by year. Overrides the bundled dataset when present. */
  holidayOverrides?: Record<number, YearHolidayData>
  /** Company rule: treat the last Saturday of each month as a workday. Default true. */
  companyLastSaturday?: boolean
}

/** A single AI-recommended priority item pointing to an existing task. */
export interface PriorityItem {
  /** Links to Task.id */
  taskId: string
  /** AI's reason for prioritization */
  reason: string
  /** Progress 0-100, stepped by 25 (0, 25, 50, 75, 100) */
  progress: number
  /** Mirrors completion state for this day's item */
  completed: boolean
  /** ISO datetime when completed, or null */
  completedAt: string | null
}

/** A single day's AI-prioritized task list. */
export interface DailyPriority {
  /** yyyy-mm-dd — the day this priority applies to */
  date: string
  /** Ordered priority items (highest priority first) */
  items: PriorityItem[]
  /** One-line action advice from AI */
  summary: string
  /** ISO datetime — when AI generated this snapshot */
  createdAt: string
  /** ISO datetime — last modification time */
  updatedAt: string
}

/** Structured result returned by the AI recommend endpoint. */
export interface AiPriorityResult {
  /** Ordered list of recommended priority task references */
  items: Array<{ taskId: string; reason: string }>
  /** One-line action advice */
  summary: string
  /** Original AI text, kept for debugging/fallback when JSON parse is partial */
  raw?: string
}

/** Pomodoro daily counter. Rolls over to 1 on a new day. */
export interface PomodoroState {
  /** yyyy-mm-dd — the day this count applies to */
  date: string
  /** Number of completed work sessions today */
  count: number
}

/** One year of holiday data (holidays + 调休补班 days). Shared by the engine, persistence, and IPC. */
export interface YearHolidayData {
  /** 法定节假日: ISO date (yyyy-mm-dd) → holiday name */
  holidays: Record<string, string>
  /** 调休补班日: ISO date → true (a weekend shifted to a workday) */
  adjustedWorkdays: Record<string, true>
}

export const DEFAULT_CONFIG: AppConfig = {
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini'
}

export function createDefaultData(): AppData {
  return {
    tasks: [],
    config: { ...DEFAULT_CONFIG },
    priorities: [],
    pomodoro: { date: '', count: 0 },
    holidayOverrides: {},
    companyLastSaturday: true
  }
}

/** Result of loading data, so the renderer can detect/recover from read failures. */
export interface LoadResult {
  data: AppData
  /** true when the file was read successfully OR didn't exist yet (first launch). */
  ok: boolean
  /** present only when an existing file failed to parse (corruption). */
  error?: string
  /** path the corrupted file was backed up to, if applicable. */
  backupPath?: string
}

// ── Multi-app collection types ───────────────────────────────────────────────

export type AppId = 'todo' | 'repoNav'

export interface AppManifest {
  id: AppId
  name: string
  icon: string
  description: string
}

export const APP_LIST: AppManifest[] = [
  { id: 'todo', name: '智能代办', icon: '📋', description: '艾森豪威尔矩阵 + AI 优先级推荐' },
  { id: 'repoNav', name: '仓库导航', icon: '🗂', description: '本地代码仓快速查找 + AI 语义搜索' },
]
