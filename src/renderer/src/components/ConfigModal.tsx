import { useState, useEffect } from 'react'
import type { AppConfig } from '@shared/types'

interface ConfigModalProps {
  config: AppConfig
  onSave: (config: AppConfig) => void
  onClose: () => void
}

export default function ConfigModal({
  config,
  onSave,
  onClose
}: ConfigModalProps): JSX.Element {
  const [apiUrl, setApiUrl] = useState(config.apiUrl)
  const [apiKey, setApiKey] = useState(config.apiKey)
  const [model, setModel] = useState(config.model)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = (): void => {
    onSave({
      apiUrl: apiUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim()
    })
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">AI 模型配置</div>
          <button className="modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal__body">
          <div className="field">
            <label className="field__label">API 地址 (Base URL)</label>
            <input
              className="input"
              placeholder="https://api.openai.com/v1"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              autoFocus
            />
            <div className="field__hint">
              基于 OpenAI 协议的接口地址，通常以 /v1 结尾，无需包含 /chat/completions
            </div>
          </div>

          <div className="field">
            <label className="field__label">API Key</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                type={showKey ? 'text' : 'password'}
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--ghost"
                style={{ flexShrink: 0 }}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
            <div className="field__hint">密钥仅保存在本地，不会上传到任何服务器</div>
          </div>

          <div className="field">
            <label className="field__label">模型名称 (Model)</label>
            <input
              className="input"
              placeholder="gpt-4o-mini"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <div className="field__hint">例如：gpt-4o-mini、gpt-4o、deepseek-chat 等</div>
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={!apiUrl.trim() || !model.trim()}
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  )
}
