import { useState, useEffect } from 'react'
import type { Task, Quadrant } from '@shared/types'
import { QUADRANTS } from '@shared/types'
import ProgressSteps from './ProgressSteps'

interface TaskModalProps {
  /** When provided, edit mode; otherwise create mode */
  task?: Task | null
  /** Default quadrant for new tasks */
  defaultQuadrant?: Quadrant
  onSave: (data: { content: string; quadrant: Quadrant; dueDate: string | null; progress: number }) => void
  onClose: () => void
}

export default function TaskModal({
  task,
  defaultQuadrant = 'q1',
  onSave,
  onClose
}: TaskModalProps): JSX.Element {
  const [content, setContent] = useState(task?.content ?? '')
  const [quadrant, setQuadrant] = useState<Quadrant>(task?.quadrant ?? defaultQuadrant)
  const [dueDate, setDueDate] = useState<string>(task?.dueDate ?? '')
  const [progress, setProgress] = useState<number>(task?.progress ?? 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = (): void => {
    const trimmed = content.trim()
    if (!trimmed) return
    onSave({
      content: trimmed,
      quadrant,
      dueDate: dueDate || null,
      progress
    })
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">{task ? '编辑任务' : '新建任务'}</div>
          <button className="modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal__body">
          <div className="field">
            <label className="field__label">任务内容</label>
            <textarea
              className="textarea"
              placeholder="请输入任务内容..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave()
              }}
            />
            <div className="field__hint">Ctrl + Enter 快速保存</div>
          </div>

          <div className="field">
            <label className="field__label">优先级（四象限）</label>
            <div className="quad-picker">
              {QUADRANTS.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className={`quad-option ${quadrant === q.id ? 'quad-option--active' : ''}`}
                  data-q={q.id}
                  onClick={() => setQuadrant(q.id)}
                >
                  <span className="quad-option__label">{q.shortLabel}</span>
                  <span className="quad-option__hint">{q.subtitle}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field__label">截止日期</label>
            <input
              className="input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label">完成进度</label>
            <ProgressSteps
              current={progress}
              completed={progress === 100}
              onChange={setProgress}
            />
            <div className="field__hint">点击 0/25/50/75/100 调整进度，100% 自动标记为已完成</div>
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn--primary" onClick={handleSave} disabled={!content.trim()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
