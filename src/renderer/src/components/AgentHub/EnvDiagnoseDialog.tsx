import { useEffect, useState } from 'react'
import type { EnvDiagnosisResult, EnvDiagnosisRow } from '@shared/agentHub'

interface EnvDiagnoseDialogProps {
  command: string
  workDir: string
  onClose: () => void
}

function rowMark(ok: boolean | null): string {
  if (ok === true) return '✅'
  if (ok === false) return '❌'
  return '·'
}

/**
 * Session environment diagnosis (v1.25.3) — one click probes git resolution,
 * repo root/remote, PATH augmentation and cmd AutoRun through the exact env
 * the embedded PTY would use, so agent-side repo/whitelist failures become
 * explainable. Report is copyable (main-process clipboard) for support.
 */
export default function EnvDiagnoseDialog({ command, workDir, onClose }: EnvDiagnoseDialogProps): JSX.Element {
  const [result, setResult] = useState<EnvDiagnosisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await window.agentHub.diagnoseEnv(command, workDir)
        if (!cancelled) setResult(r)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [command, workDir])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const asText = (r: EnvDiagnosisResult): string =>
    [
      `会话环境诊断 v${r.appVersion} @ ${r.at}`,
      `Agent 命令: ${command}`,
      `工作目录: ${workDir}`,
      '',
      ...r.rows.map((row: EnvDiagnosisRow) => `${rowMark(row.ok)} ${row.label}: ${row.value}`)
    ].join('\n')

  const handleCopy = async (): Promise<void> => {
    if (!result) return
    try {
      await window.agentHub.writeClipboard(asText(result))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // non-fatal
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal env-diagnose" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">会话环境诊断</div>
          <button className="modal__close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal__body">
          <div className="env-diagnose__meta">
            以嵌入终端完全相同的环境探测：git 解析、仓库识别、PATH 增补、cmd AutoRun。
            结果可复制后反馈给维护者定位「白名单不识别」类问题。
          </div>
          {error && <div className="env-diagnose__error">诊断失败：{error}</div>}
          {!result && !error && (
            <div className="env-diagnose__loading">
              <span className="spinner spinner--sm" /> 诊断中…
            </div>
          )}
          {result && (
            <div className="env-diagnose__rows">
              {result.rows.map((row, i) => (
                <div key={i} className="env-diagnose__row">
                  <span className="env-diagnose__mark">{rowMark(row.ok)}</span>
                  <span className="env-diagnose__label">{row.label}</span>
                  <span className="env-diagnose__value" title={row.value}>{row.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>关闭</button>
          <button className="btn btn--primary" onClick={() => void handleCopy()} disabled={!result}>
            {copied ? '✓ 已复制' : '复制诊断报告'}
          </button>
        </div>
      </div>
    </div>
  )
}
