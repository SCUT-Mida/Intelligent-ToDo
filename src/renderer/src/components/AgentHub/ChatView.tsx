import { useRef, useEffect, useState, useCallback } from 'react'
import MessageBubble from './MessageBubble'
import LogPanel from './LogPanel'
import type { AgentSession, AgentDescriptor, ChatMessage } from '@shared/agentHub'

interface ChatViewProps {
  session: AgentSession | null
  agents: AgentDescriptor[]
  logs: string[]
  logPanelOpen: boolean
  onToggleLog: () => void
  onClearLogs: () => void
  onSend: (text: string) => void
  onStop: () => void
  onPickWorkDir: () => void
}

/**
 * Main chat area: message list with auto-scroll, input area, and collapsible
 * log panel at the bottom.
 */
export default function ChatView({
  session,
  agents,
  logs,
  logPanelOpen,
  onToggleLog,
  onClearLogs,
  onSend,
  onStop,
  onPickWorkDir
}: ChatViewProps): JSX.Element {
  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isStreaming = session?.messages.some((m) => m.streaming) ?? false
  const needsWorkDir = session !== null && !session.workDir
  const agent = session ? agents.find((a) => a.id === session.agentId) : undefined

  // Auto-scroll on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [session?.messages.length, session?.messages[session.messages.length - 1]?.content])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px'
    }
  }, [inputText])

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setInputText('')
  }, [inputText, isStreaming, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl+Enter or Cmd+Enter to send
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSend()
        return
      }
      // Shift+Enter for newline
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  // Show empty state when no session is selected
  if (!session) {
    return (
      <div className="chat-view">
        <div className="chat-view__empty">
          <div className="chat-view__empty-icon">💬</div>
          <div className="chat-view__empty-text">
            选择一个会话开始对话<br />
            或点击左侧「＋ 新建」创建一个新会话
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-view">
      {needsWorkDir ? (
        <div className="chat-view__workdir-prompt">
          <div className="chat-view__workdir-prompt-icon">📁</div>
          <div className="chat-view__workdir-prompt-text">
            请先选择一个工作目录<br />
            AI 助手将在此目录下执行命令
          </div>
          <button className="btn btn--primary chat-view__workdir-prompt-btn" onClick={onPickWorkDir}>
            选择工作目录
          </button>
        </div>
      ) : session.messages.length === 0 ? (
        <div className="chat-view__empty">
          <div className="chat-view__empty-icon">{agent?.icon ?? '🤖'}</div>
          <div className="chat-view__empty-text">
            与 {agent?.name ?? 'AI 助手'} 开始对话
          </div>
          <div className="chat-view__empty-hint">
            工作目录: {session.workDir || '未设置'}
          </div>
        </div>
      ) : (
        <div className="chat-view__messages">
          {session.messages.map((msg: ChatMessage) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} className="chat-view__scroll-anchor" />
        </div>
      )}

      <div className="chat-view__input-area">
        <div className="chat-view__input-row">
          <textarea
            ref={textareaRef}
            className="chat-view__textarea"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={needsWorkDir ? '请先设置工作目录' : '输入消息… (Enter 发送，Shift+Enter 换行)'}
            disabled={needsWorkDir}
            rows={1}
          />
          {isStreaming ? (
            <button className="chat-view__stop-btn" onClick={onStop}>
              ■ 停止
            </button>
          ) : (
            <button
              className="chat-view__send-btn"
              onClick={handleSend}
              disabled={!inputText.trim() || needsWorkDir}
            >
              发送
            </button>
          )}
        </div>
      </div>

      <LogPanel
        logs={logs}
        onClear={onClearLogs}
        open={logPanelOpen}
        onToggle={onToggleLog}
      />
    </div>
  )
}
