import { useState, useEffect, useCallback } from 'react'

interface AiMemoryWizardProps {
  onSuccess: () => void
  onClose: () => void
}

/**
 * Wizard modal for generating AI semantic descriptions for repos.
 * Shows a confirmation step, then progress, then result.
 */
export default function AiMemoryWizard({ onSuccess, onClose }: AiMemoryWizardProps): JSX.Element {
  const [step, setStep] = useState<'confirm' | 'generating' | 'done' | 'error'>('confirm')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('准备中...')

  const handleGenerate = useCallback(async (): Promise<void> => {
    setStep('generating')
    setStatus('正在为仓库生成 AI 语义描述...')
    try {
      const result = await window.repoNav.regenerateMemory()
      const res = result as { success: boolean; memory?: { entries: Array<unknown> }; error?: string }
      if (res.success && res.memory) {
        setStatus(`已为 ${res.memory.entries.length} 个仓库生成描述`)
        setStep('done')
      } else {
        setError(res.error ?? '生成失败，未知错误')
        setStep('error')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
              <p>将为扫描到的所有仓库生成 AI 语义描述，这将调用您的 LLM API。</p>
              <p className="ai-memory-wizard__hint">
                根据仓库数量和 API 响应速度，预计需要 10-60 秒。生成的描述存储在本地，不会上传。
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
              <div className="ai-memory-wizard__icon ai-memory-wizard__icon--error">❌</div>
              <p className="field__hint field__hint--error">{error}</p>
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
