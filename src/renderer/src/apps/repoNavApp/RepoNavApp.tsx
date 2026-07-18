import { useState, useEffect, useCallback } from 'react'
import RepoNavView from '../../components/RepoNav/RepoNavView'
import AiMemoryWizard from './AiMemoryWizard'

interface RepoMemoryEntry {
  name: string
  path: string
  description: string | null
  tags: string[]
  generatedAt: string
}

interface RepoMemoryData {
  version: number
  generatedAt: string
  entries: RepoMemoryEntry[]
}

/**
 * RepoNavApp wraps RepoNavView with the AI memory feature:
 * - Memory status indicator (badge showing count or "未生成")
 * - Button to open the memory generation wizard
 *
 * Removed in v1.11.5: AI semantic search input. Users reported the LLM
 * search consistently underperformed (wrong matches, missed obvious tags).
 * Search is now 100% local substring matching done inside RepoNavView's
 * filter — matching against path, name, AND the AI-generated tags /
 * descriptions surfaced here via the memoryMap prop.
 */
export default function RepoNavApp(): JSX.Element {
  const [memory, setMemory] = useState<RepoMemoryData | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [scanKey, setScanKey] = useState(0) // used to re-trigger scan from wizard

  // Load memory on mount
  useEffect(() => {
    loadMemory()
  }, [])

  const loadMemory = useCallback(async (): Promise<void> => {
    setMemoryLoading(true)
    try {
      const mem = await window.repoNav.getMemory()
      setMemory(mem as RepoMemoryData | null)
    } catch {
      setMemory(null)
    } finally {
      setMemoryLoading(false)
    }
  }, [])

  const handleMemoryGenerated = useCallback((): void => {
    setWizardOpen(false)
    loadMemory()
    setScanKey((k) => k + 1) // re-trigger scan so RepoNavView reloads
  }, [loadMemory])

  // Build memoryMap from memory entries for passing to RepoNavView.
  // RepoNavView's filter function matches against path/name/tags/description,
  // so this is what makes the AI-generated tags searchable locally.
  const memoryMap: Record<string, { description: string | null; tags: string[] }> = {}
  if (memory) {
    for (const entry of memory.entries) {
      memoryMap[entry.path] = { description: entry.description, tags: entry.tags }
    }
  }

  return (
    <div className="repo-nav-app">
      {/* Memory status bar */}
      <div className="repo-nav-app__memory-bar">
        <span className="repo-nav-app__memory-status">
          {memoryLoading ? (
            <>AI 记忆: 加载中...</>
          ) : memory && memory.entries.length > 0 ? (
            <>AI 记忆: {memory.entries.length} 个仓库已生成标签和描述（本地搜索已生效）</>
          ) : (
            <>AI 记忆: 未生成（点击右侧按钮，AI 会读取各仓库 README 生成标签）</>
          )}
        </span>
        <button
          className="btn btn--ghost"
          style={{ fontSize: 12 }}
          onClick={() => setWizardOpen(true)}
        >
          {memory && memory.entries.length > 0 ? '重新生成' : '生成 AI 记忆'}
        </button>
      </div>

      {/* RepoNavView handles all search via its local filter */}
      <RepoNavView key={scanKey} memoryMap={memoryMap} />

      {/* AI Memory Wizard */}
      {wizardOpen && (
        <AiMemoryWizard
          onSuccess={handleMemoryGenerated}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  )
}
