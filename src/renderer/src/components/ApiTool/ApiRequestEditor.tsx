import { useState, useMemo } from 'react'
import type { ApiKeyValue, ApiRequestSpec, ApiBodyType, ApiHttpMethod } from '@shared/apiTool'
import { createApiKeyValue, validateJsonBody, buildFinalUrl } from '@shared/apiTool'

interface ApiRequestEditorProps {
  spec: ApiRequestSpec
  onChange: (spec: ApiRequestSpec) => void
  onSend: () => void
  onSave: () => void
  sending: boolean
}

type Section = 'params' | 'headers' | 'body'

/** Editable key/value rows with per-row enable checkbox + delete. */
function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder
}: {
  rows: ApiKeyValue[]
  onChange: (rows: ApiKeyValue[]) => void
  keyPlaceholder: string
  valuePlaceholder: string
}): JSX.Element {
  const update = (id: string, patch: Partial<ApiKeyValue>): void => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  return (
    <div className="kv-editor">
      {rows.length === 0 && (
        <div className="kv-editor__empty">暂无条目。点击下方「＋ 添加」。</div>
      )}
      {rows.map((row) => (
        <div key={row.id} className={`kv-editor__row ${row.enabled ? '' : 'kv-editor__row--off'}`}>
          <input
            type="checkbox"
            className="kv-editor__check"
            checked={row.enabled}
            onChange={(e) => update(row.id, { enabled: e.target.checked })}
            title={row.enabled ? '禁用该行' : '启用该行'}
          />
          <input
            className="input kv-editor__key"
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) => update(row.id, { key: e.target.value })}
          />
          <input
            className="input kv-editor__value"
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(e) => update(row.id, { value: e.target.value })}
          />
          <button
            className="kv-editor__del"
            title="删除该行"
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="btn btn--ghost kv-editor__add"
        onClick={() => onChange([...rows, createApiKeyValue()])}
      >
        ＋ 添加
      </button>
    </div>
  )
}

/**
 * Request builder — method/URL bar on top; Params / Headers / Body sections
 * below. GET disables the body section (body is ignored server-side anyway).
 */
export default function ApiRequestEditor({
  spec,
  onChange,
  onSend,
  onSave,
  sending
}: ApiRequestEditorProps): JSX.Element {
  const [section, setSection] = useState<Section>('params')

  const jsonError = useMemo(
    () => (spec.method === 'POST' && spec.bodyType === 'json' ? validateJsonBody(spec.body) : null),
    [spec.method, spec.bodyType, spec.body]
  )

  const canSend = spec.url.trim() !== '' && !jsonError && !sending

  const finalUrlPreview = useMemo(() => {
    try {
      return spec.url.trim() ? buildFinalUrl(spec.url.trim(), spec.params) : ''
    } catch {
      return spec.url
    }
  }, [spec.url, spec.params])

  const formatJson = (): void => {
    try {
      const parsed = JSON.parse(spec.body)
      onChange({ ...spec, body: JSON.stringify(parsed, null, 2) })
    } catch {
      // invalid JSON — the inline hint already reports it
    }
  }

  const setBodyType = (bodyType: ApiBodyType): void => onChange({ ...spec, bodyType })

  return (
    <div className="api-editor">
      {/* Method + URL + actions */}
      <div className="api-editor__bar">
        <select
          className={`select api-editor__method ${spec.method === 'GET' ? 'api-editor__method--get' : 'api-editor__method--post'}`}
          value={spec.method}
          onChange={(e) => onChange({ ...spec, method: e.target.value as ApiHttpMethod })}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </select>
        <input
          className="input api-editor__url"
          type="text"
          placeholder="https://example.com/api/v1/users"
          value={spec.url}
          onChange={(e) => onChange({ ...spec, url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSend) onSend()
          }}
          spellCheck={false}
        />
        <button
          className="btn btn--ghost api-editor__save"
          onClick={onSave}
          disabled={!spec.url.trim()}
          title="收藏当前请求（可重命名）"
        >
          保存
        </button>
        <button className="btn btn--primary" onClick={onSend} disabled={!canSend}>
          {sending ? '发送中…' : '发送'}
        </button>
      </div>

      {finalUrlPreview && finalUrlPreview !== spec.url.trim() && (
        <div className="api-editor__url-preview" title={finalUrlPreview}>
          实际请求：{finalUrlPreview}
        </div>
      )}

      {/* Section tabs */}
      <div className="api-editor__tabs">
        <button
          className={`api-editor__tab ${section === 'params' ? 'api-editor__tab--active' : ''}`}
          onClick={() => setSection('params')}
        >
          Params {spec.params.length > 0 ? `(${spec.params.filter((p) => p.enabled).length})` : ''}
        </button>
        <button
          className={`api-editor__tab ${section === 'headers' ? 'api-editor__tab--active' : ''}`}
          onClick={() => setSection('headers')}
        >
          Headers {spec.headers.length > 0 ? `(${spec.headers.filter((h) => h.enabled).length})` : ''}
        </button>
        <button
          className={`api-editor__tab ${section === 'body' ? 'api-editor__tab--active' : ''} ${spec.method === 'GET' ? 'api-editor__tab--disabled' : ''}`}
          onClick={() => spec.method !== 'GET' && setSection('body')}
          title={spec.method === 'GET' ? 'GET 请求不发送 body' : undefined}
        >
          Body{spec.method === 'GET' ? '（GET 无）' : ''}
        </button>
      </div>

      <div className="api-editor__sections">
        {section === 'params' && (
          <KeyValueEditor
            rows={spec.params}
            onChange={(params) => onChange({ ...spec, params })}
            keyPlaceholder="参数名，如 page"
            valuePlaceholder="值，如 1"
          />
        )}

        {section === 'headers' && (
          <KeyValueEditor
            rows={spec.headers}
            onChange={(headers) => onChange({ ...spec, headers })}
            keyPlaceholder="Header 名，如 Authorization"
            valuePlaceholder="值，如 Bearer xxx"
          />
        )}

        {section === 'body' && spec.method === 'POST' && (
          <div className="api-editor__body">
            <div className="api-editor__body-bar">
              {(['json', 'text'] as const).map((t) => (
                <label key={t} className={`api-editor__body-type ${spec.bodyType === t ? 'api-editor__body-type--active' : ''} ${spec.bodyType === 'none' && t === 'json' ? 'api-editor__body-type--active' : ''}`}>
                  <input
                    type="radio"
                    name="bodyType"
                    value={t}
                    checked={spec.bodyType === t}
                    onChange={() => setBodyType(t)}
                  />
                  <span>{t === 'json' ? 'JSON' : '文本'}</span>
                </label>
              ))}
              {spec.bodyType === 'json' && (
                <button className="btn btn--ghost api-editor__format" onClick={formatJson} title="格式化 JSON">
                  {'{}'} 格式化
                </button>
              )}
            </div>
            <textarea
              className="input api-editor__body-text"
              value={spec.body}
              onChange={(e) => onChange({ ...spec, body: e.target.value })}
              placeholder={spec.bodyType === 'json' ? '{ "key": "value" }' : '原始文本内容'}
              spellCheck={false}
              rows={10}
            />
            {jsonError && <div className="api-editor__body-error">{jsonError}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
