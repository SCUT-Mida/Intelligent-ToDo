import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  title: string
  /** Main message (supports \n). */
  message: string
  /** Optional monospace detail block (e.g. the exact command to execute). */
  detail?: string
  confirmText?: string
  cancelText?: string
  /** Danger styling for the confirm button (destructive actions). */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Shared confirmation dialog (v1.23) — replaces ad-hoc window.confirm calls
 * for flows that benefit from showing the exact payload (command strings,
 * templates). Follows the NewSessionDialog overlay idiom: backdrop-click and
 * Esc cancel, Enter confirms.
 */
export default function ConfirmDialog({
  title,
  message,
  detail,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div className="modal confirm-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">{title}</div>
        </div>
        <div className="modal__body">
          <div className="confirm-dialog__message">{message}</div>
          {detail && <pre className="confirm-dialog__detail">{detail}</pre>}
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onCancel}>{cancelText}</button>
          <button
            ref={confirmRef}
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
