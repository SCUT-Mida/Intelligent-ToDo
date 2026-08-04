import type { AgentDefinition } from '@shared/agentHub'
import hermesIcon from './assets/hermes-icon.png'

interface AgentIconProps {
  /** The agent definition. Falls back to emoji via `agent.icon`. */
  agent: Pick<AgentDefinition, 'id' | 'icon'> | undefined
  /** Extra CSS class for sizing/fit (e.g. `agent-picker__option-icon`). */
  className?: string
  /** SVG size in px for inline brand marks. Ignored for emoji/PNG. */
  size?: number
}

/**
 * Renders an agent's brand icon.
 *
 * Uses the OFFICIAL brand mark as an inline SVG for built-in agents
 * (claude / claude 星芒, opencode "O" mark, hermes PNG glyph), replacing the
 * emoji placeholders. Internal wrappers (codeagent wrapping Claude Code, NGA
 * wrapping OpenCode) render the underlying brand mark with a small corner
 * badge to distinguish them from the official tool.
 *
 * Falls back to the emoji in `agent.icon` for anything unmapped (e.g. custom
 * agents added at runtime).
 */
export default function AgentIcon({ agent, className, size = 16 }: AgentIconProps): JSX.Element {
  if (!agent) return <span className={className}>💬</span>

  switch (agent.id) {
    case 'claude':
      return (
        <span className={`agent-icon ${className ?? ''}`}>
          <ClaudeMark size={size} />
        </span>
      )
    case 'codeagent':
      return (
        <span className={`agent-icon agent-icon--wrapper ${className ?? ''}`}>
          <ClaudeMark size={size} />
          <span className="agent-icon__badge" aria-hidden="true">
            W
          </span>
        </span>
      )
    case 'opencode':
      return (
        <span className={`agent-icon ${className ?? ''}`}>
          <OpenCodeMark size={size} />
        </span>
      )
    case 'nga':
      return (
        <span className={`agent-icon agent-icon--wrapper ${className ?? ''}`}>
          <OpenCodeMark size={size} />
          <span className="agent-icon__badge" aria-hidden="true">
            W
          </span>
        </span>
      )
    case 'hermes':
      return (
        <span className={`agent-icon ${className ?? ''}`}>
          <img className="agent-icon__img" src={hermesIcon} alt="" width={size} height={size} />
        </span>
      )
    default:
      // Custom / unmapped agents → emoji fallback.
      return <span className={className}>{agent.icon}</span>
  }
}

/** Claude brand mark (Anthropic starburst, official orange). */
function ClaudeMark({ size }: { size: number }): JSX.Element {
  return (
    <svg
      className="agent-icon__svg"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z"
        fill="#d97757"
      />
    </svg>
  )
}

/** OpenCode brand mark ("O" letterform, currentColor for theme adaptation). */
function OpenCodeMark({ size }: { size: number }): JSX.Element {
  return (
    <svg
      className="agent-icon__svg"
      width={size}
      height={size}
      viewBox="0 0 24 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M24 24H6V18H18V12H24V24ZM6 18H0V12H6V18Z"
        fill="currentColor"
        fillOpacity="0.2"
      />
      <path
        d="M6 24H24V30H0V18H6V24ZM18 18H6V12H18V18ZM24 12H18V6H0V0H24V12Z"
        fill="currentColor"
        fillOpacity="0.9"
      />
    </svg>
  )
}