import { useState, useEffect, useCallback } from 'react'
import RepoNavView from '../../components/RepoNav/RepoNavView'
import AiMemoryWizard from './AiMemoryWizard'
import GuideModal from '../../components/GuideModal'
import { REPO_NAV_GUIDE } from '../../guides/repoNavGuide'
import type { RepoUserData } from '@shared/repoNav'

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
 * RepoNavApp wraps RepoNavView with the AI memory feature and per-user data
 * (favorites, user tags, open counts).
 *
 * The per-user data is loaded once and held in React state; any mutation
 * flows through `updateUserData` which both updates local state (so the UI
 * reflects immediately) and persists via `saveUserData` IPC (so it survives
 * restarts).
 */
export default function RepoNavApp(): JSX.Element {
  const [memory, setMemory] = useState<RepoMemoryData | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [scanKey, setScanKey] = useState(0)

  const [userData, setUserData] = useState<RepoUserData | null>(null)

  // Load memory + userData on mount
  useEffect(() => {
    loadMemory()
    void (async () => {
      try {
        const data = await window.repoNav.getUserData()
        setUserData(data)
      } catch {
        // Best-effort — userData is non-critical
      }
    })()
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

  /**
   * Update a slice of userData. Optimistically updates local state, then
   * persists via IPC. Non-blocking — UI feels instant.
   */
  const updateUserData = useCallback(async (patch: Partial<RepoUserData>): Promise<void> => {
    if (!userData) return
    const next = { ...userData, ...patch }
    setUserData(next)
    try {
      const saved = await window.repoNav.saveUserData(next)
      setUserData(saved)
    } catch {
      console.error('Failed to persist user data')
    }
  }, [userData])

  // Repo open handler — bump open count in local state (backend also bumps
  // its own count independently; we sync on next getUserData).
  const handleRepoOpen = useCallback((repoPath: string): void => {
    if (!userData) return
    const next: RepoUserData = {
      ...userData,
      openCounts: {
        ...userData.openCounts,
        [repoPath]: (userData.openCounts[repoPath] ?? 0) + 1
      },
      lastOpenedAt: {
        ...userData.lastOpenedAt,
        [repoPath]: new Date().toISOString()
      }
    }
    setUserData(next)
  }, [userData])

  const toggleFavorite = useCallback((repoPath: string): void => {
    if (!userData) return
    const isFav = userData.favorites.includes(repoPath)
    const favorites = isFav
      ? userData.favorites.filter((p) => p !== repoPath)
      : [...userData.favorites, repoPath]
    void updateUserData({ favorites })
  }, [userData, updateUserData])

  const addUserTag = useCallback((repoPath: string, tag: string): void => {
    if (!userData) return
    const existing = userData.userTags[repoPath] ?? []
    if (existing.includes(tag)) return
    void updateUserData({
      userTags: {
        ...userData.userTags,
        [repoPath]: [...existing, tag]
      }
    })
  }, [userData, updateUserData])

  const removeUserTag = useCallback((repoPath: string, tag: string): void => {
    if (!userData) return
    const existing = userData.userTags[repoPath] ?? []
    void updateUserData({
      userTags: {
        ...userData.userTags,
        [repoPath]: existing.filter((t) => t !== tag)
      }
    })
  }, [userData, updateUserData])

  const handleMemoryGenerated = useCallback((): void => {
    setWizardOpen(false)
    loadMemory()
    setScanKey((k) => k + 1) // re-trigger scan so RepoNavView reloads
  }, [loadMemory])

  // Build memoryMap from memory entries for passing to RepoNavView
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
        <button
          className="toolbar__help-btn"
          onClick={() => setGuideOpen(true)}
          title="使用指南"
          style={{ marginLeft: 'auto' }}
        >
          ?
        </button>
      </div>

      <RepoNavView
        key={scanKey}
        memoryMap={memoryMap}
        userData={userData}
        onToggleFavorite={toggleFavorite}
        onAddUserTag={addUserTag}
        onRemoveUserTag={removeUserTag}
        onRepoOpen={handleRepoOpen}
      />

      {wizardOpen && (
        <AiMemoryWizard
          onSuccess={handleMemoryGenerated}
          onClose={() => setWizardOpen(false)}
        />
      )}

      {guideOpen && (
        <GuideModal title="仓库导航使用指南" content={REPO_NAV_GUIDE} onClose={() => setGuideOpen(false)} />
      )}
    </div>
  )
}
