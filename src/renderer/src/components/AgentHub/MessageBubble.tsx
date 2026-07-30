import { useState, useCallback } from 'react'
import MiniMarkdown from './MiniMarkdown'
import type { ChatMessage, ToolCall } from '@shared/agentHub'

interface MessageBubbleProps {
  message: ChatMessage
}

/**
 * Renders a single chat message with appropriate styling based on role.
 *
 * - User messages: right-aligned, primary-soft background.
 * - Assistant messages: left-aligned, surface background, rendered as markdown.
 * - System messages: centered, muted.
 * - Streaming messages: blinking cursor at end.
 * - Error messages: red border + styling.
 * - Tool calls: collapsible cards.
 */
export default function MessageBubble({ message }: MessageBubbleProps): JSX.Element {
  const hasError = !!message.error
  const displayContent = hasError ? message.error : message.content

  const classNames = [
    'message',
    `message--${message.role}`,
    hasError ? 'message--error' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classNames}>
      <div className="message__bubble">
        {message.role === 'assistant' ? (
          <>
            <MiniMarkdown content={displayContent ?? ''} />
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {message.toolCalls.map((tool, i) => (
                  <ToolCallCard key={i} tool={tool} />
                ))}
              </div>
            )}
          </>
        ) : (
          <span>{displayContent}</span>
        )}
        {message.streaming && <span className="message__cursor" />}
      </div>
      <div className="message__timestamp">
        {formatTime(message.timestamp)}
        {message.tokenCount !== undefined && ` · ${message.tokenCount} tokens`}
      </div>
    </div>
  )
}

// ── Tool call card ──────────────────────────────────────────────────────

function ToolCallCard({ tool }: { tool: ToolCall }): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const toggle = useCallback(() => setExpanded((v) => !v), [])

  const statusIcon = (): string => {
    switch (tool.status) {
      case 'running':
        return '⟳'
      case 'success':
        return '✓'
      case 'error':
        return '✗'
      default:
        return '·'
    }
  }

  const statusClass = (): string => {
    switch (tool.status) {
      case 'running':
        return 'tool-call__status-icon--running'
      case 'success':
        return 'tool-call__status-icon--success'
      case 'error':
        return 'tool-call__status-icon--error'
      default:
        return ''
    }
  }

  return (
    <div className="tool-call">
      <div className="tool-call__header" onClick={toggle}>
        <span className={`tool-call__status-icon ${statusClass()}`}>{statusIcon()}</span>
        <span className="tool-call__name">{tool.name}</span>
        <span className={`tool-call__arrow ${expanded ? 'tool-call__arrow--open' : ''}`}>▶</span>
      </div>
      {expanded && (
        <div className="tool-call__body">
          {tool.input !== undefined && (
            <div className="tool-call__section">
              <div className="tool-call__section-label">输入</div>
              <div className="tool-call__section-content">{tool.input}</div>
            </div>
          )}
          {tool.output !== undefined && (
            <div className="tool-call__section">
              <div className="tool-call__section-label">输出</div>
              <div className="tool-call__section-content">{tool.output}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Time formatting ─────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)

    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin} 分钟前`

    const hours = d.getHours().toString().padStart(2, '0')
    const minutes = d.getMinutes().toString().padStart(2, '0')

    if (d.toDateString() === now.toDateString()) {
      return `今天 ${hours}:${minutes}`
    }

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) {
      return `昨天 ${hours}:${minutes}`
    }

    const month = (d.getMonth() + 1).toString().padStart(2, '0')
    const day = d.getDate().toString().padStart(2, '0')
    return `${month}-${day} ${hours}:${minutes}`
  } catch {
    return iso
  }
}
