import { useState, useEffect, useCallback } from 'react'
import RepoNavView from '../../components/RepoNav/RepoNavView'
import AiMemoryWizard from './AiMemoryWizard'

// TODO: replace with shared RepoMemory type when backend lands
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
 * RepoNavApp wraps the existing RepoNavView with AI memory features:
 * - Memory status indicator (badge showing count or "未生成")
 * - AI semantic search input above the existing char-filter
 * - Auto-trigger memory wizard after scan if configured
 */
export default function RepoNavApp(): JSX.Element {
  const [memory, setMemory] = useState<RepoMemoryData | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [aiQuery, setAiQuery] = useState('')
  const [aiResults, setAiResults] = useState<Array<{ repoPath: string; repoName: string; score: number; reason: string }> | null>(null)
  const [aiSearching, setAiSearching] = useState(false)
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

  const handleAiSearch = useCallback(async (): Promise<void> => {
    const q = aiQuery.trim()
    if (!q) {
      setAiResults(null)
      return
    }
    setAiSearching(true)
    try {
      const results = await window.repoNav.searchRepos(q)
      setAiResults(results as Array<{ repoPath: string; repoName: string; score: number; reason: string }>)
    } catch {
      setAiResults([])
    } finally {
      setAiSearching(false)
    }
  }, [aiQuery])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      handleAiSearch()
    }
  }, [handleAiSearch])

  // Build memoryMap from memory entries for passing to RepoNavView
  const memoryMap: Record<string, { description: string | null; tags: string[] }> = {}
  if (memory) {
    for (const entry of memory.entries) {
      memoryMap[entry.path] = { description: entry.description, tags: entry.tags }
    }
  }

  return (
    <div className="repo-nav-app">
      {/* AI Memory Status */}
      <div className="repo-nav-app__memory-bar">
        <span className="repo-nav-app__memory-status">
          {memoryLoading ? (
            <>AI 记忆: 加载中...</>
          ) : memory && memory.entries.length > 0 ? (
            <>AI 记忆: {memory.entries.length} 个仓库已描述</>
          ) : (
            <>AI 记忆: 未生成</>
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

      {/* AI Semantic Search */}
      <div className="repo-nav-app__ai-search">
        <div className="repo-nav-app__ai-search-icon">🔍</div>
        <input
          className="input ai-search-input"
          type="text"
          placeholder="用自然语言搜索仓库，比如「我那个做 todo 的项目」"
          value={aiQuery}
          onChange={(e) => {
            setAiQuery(e.target.value)
            if (!e.target.value.trim()) setAiResults(null)
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          className="btn btn--primary"
          onClick={handleAiSearch}
          disabled={aiSearching || !aiQuery.trim()}
          style={{ flexShrink: 0 }}
        >
          {aiSearching ? '搜索中...' : 'AI 搜索'}
        </button>
      </div>

      {/* AI Search Results */}
      {aiResults !== null && (
        <div className="repo-nav-app__ai-results">
          <div className="repo-nav-app__ai-results-header">
            AI 搜索结果 ({aiResults.length} 条)
          </div>
          {aiResults.length === 0 ? (
            <div className="repo-nav-app__ai-results-empty">未找到匹配的仓库</div>
          ) : (
            <div className="repo-nav-app__ai-results-list">
              {aiResults.map((r) => (
                <div key={r.repoPath} className="repo-nav-app__ai-result-item">
                  <span className="repo-nav-app__ai-result-name">{r.repoName}</span>
                  <span className="repo-nav-app__ai-result-path">{r.repoPath}</span>
                  <div className="repo-nav-app__ai-result-reason">{r.reason}</div>
                  <span className="repo-nav-app__ai-result-score">{(r.score * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Existing RepoNavView — pass scanKey to force re-mount after memory gen */}
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
