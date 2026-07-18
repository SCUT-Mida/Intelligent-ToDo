import { useState, type ReactNode } from 'react'

interface SectionProps {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * Collapsible settings section with clickable header and chevron.
 * Extracted from ConfigModal for reuse across UnifiedSettingsModal.
 */
export default function Section({ title, children, defaultOpen = true }: SectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="settings-section">
      <button type="button" className="settings-section__head" onClick={() => setOpen((v) => !v)}>
        <span className={`settings-section__chevron ${open ? 'settings-section__chevron--open' : ''}`}>›</span>
        {title}
      </button>
      {open && <div className="settings-section__body">{children}</div>}
    </div>
  )
}
