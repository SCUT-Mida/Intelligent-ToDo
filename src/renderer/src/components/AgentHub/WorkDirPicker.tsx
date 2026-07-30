import { useCallback } from 'react'

interface WorkDirPickerProps {
  value: string
  onChange: (path: string) => void
  /** When true, the browse button is disabled (no active session). */
  disabled?: boolean
}

/**
 * Shows the current working directory path (or placeholder) with a
 * "浏览…" button that opens the OS folder picker via IPC.
 */
export default function WorkDirPicker({ value, onChange, disabled }: WorkDirPickerProps): JSX.Element {
  const handlePick = useCallback(async () => {
    if (disabled) return
    try {
      const result = await window.agentHub.pickDirectory()
      if (result) {
        onChange(result)
      }
    } catch (err: unknown) {
      console.error('Failed to pick directory', err)
    }
  }, [onChange, disabled])

  return (
    <div className="workdir-picker">
      <span
        className={`workdir-picker__path ${!value ? 'workdir-picker__path--empty' : ''}`}
        title={value || undefined}
      >
        {value || '未选择工作目录'}
      </span>
      <button
        className="btn btn--ghost workdir-picker__btn"
        onClick={handlePick}
        disabled={disabled}
        title={disabled ? '请先选择或新建一个会话' : undefined}
      >
        浏览…
      </button>
    </div>
  )
}
