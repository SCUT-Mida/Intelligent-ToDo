import { useEffect, useRef, useState } from 'react'
import type { AgentDescriptor } from '@shared/agentHub'

interface TaskRunDialogProps {
  sessionTitle: string
  agent: AgentDescriptor | null
  workDir: string
  /** Pre-filled prompt (e.g. cross-app task hand-off from Todo). */
  initialPrompt?: string
  onClose: () => void
  onRun: (prompt: string, background: boolean) => void
}

/**
 * Dialog composing a one-shot structured task run (v1.23): the prompt is
 * sent to the session's agent as a NON-interactive run whose output is
 * parsed into a structured timeline (stream-json for Claude Code, plain
 * text otherwise) and persisted to the session's event log.
 */
export default function TaskRunDialog({
  sessionTitle,
  agent,
  workDir,
  initialPrompt,
  onClose,
  onRun
}: TaskRunDialogProps): JSX.Element {
  const [prompt, setPrompt] = useState(initialPrompt ?? '')
  const [background, setBackground] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const canRun = prompt.trim().length > 0 && !!agent

  const handleRun = (): void => {
    if (!canRun) return
    onRun(prompt.trim(), background)
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal task-run-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">运行结构化任务</div>
          <button className="modal__close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal__body">
          <div className="task-run-dialog__meta">
            <span className="task-run-dialog__chip">{agent?.icon ?? '🤖'} {agent?.name ?? '未检测到 agent'}</span>
            <span className="task-run-dialog__chip task-run-dialog__chip--dir" title={workDir}>
              📁 {workDir ? workDir.split(/[\\/]/).pop() : '（无工作目录）'}
            </span>
            <span className="task-run-dialog__chip">{sessionTitle}</span>
          </div>
          <div className="field">
            <label className="field__label">任务提示词</label>
            <textarea
              ref={textareaRef}
              className="input task-run-dialog__prompt"
              placeholder="描述要让 agent 一次性完成的任务，例如：&#10;梳理这个仓库的构建流程，输出一份分步说明"
              value={prompt}
              rows={8}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  handleRun()
                }
              }}
            />
            <div className="field__hint">
              任务以非交互方式运行（Claude Code 使用 <code className="inline-code">-p --output-format stream-json</code>），
              输出解析为结构化时间线并写入会话事件日志。
            </div>
          </div>
          <label className="task-run-dialog__bg">
            <input
              type="checkbox"
              checked={background}
              onChange={(e) => setBackground(e.target.checked)}
            />
            <span>后台运行（可切换到其他应用，完成后事件照常记录）</span>
          </label>
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={handleRun} disabled={!canRun}>
            ▶ 运行任务
          </button>
        </div>
      </div>
    </div>
  )
}
