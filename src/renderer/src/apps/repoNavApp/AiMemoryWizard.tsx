import { useState, useEffect, useCallback } from 'react'

interface AiMemoryWizardProps {
  onSuccess: () => void
  onClose: () => void
}

type ErrorKind = 'auth' | 'not-found' | 'network' | 'timeout' | 'config' | 'unknown'

interface RegenerateResult {
  success: boolean
  memory?: { entries: Array<unknown> }
  error?: string
  errorKind?: ErrorKind
  hint?: string
}

/** Friendly labels and icons for each error kind. */
const ERROR_KIND_INFO: Record<ErrorKind, { icon: string; label: string }> = {
  auth: { icon: '🔑', label: '认证失败' },
  'not-found': { icon: '🔍', label: '配置错误' },
  network: { icon: '🌐', label: '网络问题' },
  timeout: { icon: '⏱', label: '请求超时' },
  config: { icon: '⚙️', label: '配置问题' },
  unknown: { icon: '❓', label: '未知错误' }
}

/**
 * Wizard modal for generating AI semantic descriptions for repos.
 * Shows a confirmation step, then progress, then result.
 *
 * Errors are categorized (auth / not-found / network / timeout / config /
 * unknown) with a friendly icon + label and an actionable hint telling the
 * user where to fix the issue.
 */
export default function AiMemoryWizard({ onSuccess, onClose }: AiMemoryWizardProps): JSX.Element {
  const [step, setStep] = useState<'confirm' | 'generating' | 'done' | 'error'>('confirm')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<ErrorKind>('unknown')
  const [hint, setHint] = useState<string | null>(null)
  const [status, setStatus] = useState('准备中...')

  const handleGenerate = useCallback(async (): Promise<void> => {
    setStep('generating')
    setStatus('正在为仓库生成 AI 语义描述（读取 README + 元数据）...')
    try {
      const result = await window.repoNav.regenerateMemory()
      const res = result as RegenerateResult
      if (res.success && res.memory) {
        setStatus(`已为 ${res.memory.entries.length} 个仓库生成描述`)
        setStep('done')
      } else {
        setErrorMsg(res.error ?? '生成失败，未知错误')
        setErrorKind(res.errorKind ?? 'unknown')
        setHint(res.hint ?? null)
        setStep('error')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(msg)
      setErrorKind('unknown')
      setHint(null)
      setStep('error')
    }
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && step !== 'generating') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, step])

  const kindInfo = ERROR_KIND_INFO[errorKind]

  return (
    <div className="overlay" onMouseDown={step !== 'generating' ? onClose : undefined}>
      <div className="modal ai-memory-wizard" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">AI 记忆生成</div>
          {step !== 'generating' && (
            <button className="modal__close" onClick={onClose} aria-label="关闭">×</button>
          )}
        </div>
        <div className="modal__body">
          {step === 'confirm' && (
            <div className="ai-memory-wizard__confirm">
              <div className="ai-memory-wizard__icon">🤖</div>
              <p>将为扫描到的所有仓库生成 AI 描述和标签，会读取每个仓库的 README.md 一起送给 LLM。</p>
              <p className="ai-memory-wizard__hint">
                根据仓库数量和 API 响应速度，预计需要 10-60 秒。生成的数据存储在本地，不会上传。
              </p>
            </div>
          )}

          {step === 'generating' && (
            <div className="ai-memory-wizard__progress">
              <div className="spinner" />
              <div className="ai-memory-wizard__status">{status}</div>
              <div className="ai-memory-wizard__bar">
                <div className="ai-memory-wizard__bar-fill ai-memory-wizard__bar-fill--indeterminate" />
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="ai-memory-wizard__done">
              <div className="ai-memory-wizard__icon ai-memory-wizard__icon--success">✅</div>
              <p>{status}</p>
            </div>
          )}

          {step === 'error' && (
            <div className="ai-memory-wizard__error">
              <div className="ai-memory-wizard__error-head">
                <span className="ai-memory-wizard__error-icon">{kindInfo.icon}</span>
                <span className="ai-memory-wizard__error-label">{kindInfo.label}</span>
              </div>
              <div className="ai-memory-wizard__error-detail">
                <div className="ai-memory-wizard__error-msg">{errorMsg}</div>
                {hint && (
                  <div className="ai-memory-wizard__error-hint">
                    <strong>如何解决：</strong>{hint}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="modal__footer">
          {step === 'confirm' && (
            <>
              <button className="btn btn--ghost" onClick={onClose}>稍后再说</button>
              <button className="btn btn--primary" onClick={handleGenerate}>开始生成</button>
            </>
          )}
          {step === 'done' && (
            <button className="btn btn--primary" onClick={onSuccess}>完成</button>
          )}
          {step === 'error' && (
            <>
              <button className="btn btn--ghost" onClick={onClose}>关闭</button>
              <button className="btn btn--primary" onClick={handleGenerate}>重试</button>
            </>
          )}
          {step === 'generating' && (
            <button className="btn btn--ghost" disabled>生成中...</button>
          )}
        </div>
      </div>
    </div>
  )
}
