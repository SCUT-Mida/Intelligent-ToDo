import { useState, type ReactNode } from 'react'

interface SectionProps {
  title: string
  /** Optional emoji/icon shown to the left of the title. */
  icon?: string
  /** Optional small uppercase label above the title (macOS-style). */
  label?: string
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * Collapsible settings section, macOS System Settings style.
 *
 * Visual: white rounded card with subtle border + shadow. Header has optional
 * icon + label + title + chevron. Body is padded inside the card.
 */
export default function Section({ title, icon, label, children, defaultOpen = true }: SectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`settings-section ${open ? 'settings-section--open' : ''}`}>
      <button type="button" className="settings-section__head" onClick={() => setOpen((v) => !v)}>
        {icon && <span className="settings-section__icon">{icon}</span>}
        <span className="settings-section__title-group">
          {label && <span className="settings-section__label">{label}</span>}
          <span className="settings-section__title">{title}</span>
        </span>
        <span className={`settings-section__chevron ${open ? 'settings-section__chevron--open' : ''}`}>›</span>
      </button>
      {open && <div className="settings-section__body">{children}</div>}
    </div>
  )
}
