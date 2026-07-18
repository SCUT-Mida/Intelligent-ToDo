/**
 * Reusable LLM (OpenAI-compatible) chat completions client.
 *
 * Extracted from the aiRecommend function in src/main/index.ts.
 * Provides a generic callLLM() that any feature (Todo priority, Repo AI memory, etc.)
 * can use without duplicating HTTP/networking logic.
 */

import { netFetch } from './netFetch'
import type { NetResponse } from './netFetch'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMCallOptions {
  apiUrl: string
  apiKey: string
  model: string
  messages: LLMMessage[]
  temperature?: number
  timeoutMs?: number
  maxTokens?: number
}

export interface LLMCallResult {
  content: string
  finishReason?: string
  raw?: unknown
}

/**
 * Call an OpenAI-compatible chat completions endpoint.
 *
 * @throws {Error} with Chinese messages on failure (missing config, network,
 *                 non-200 status, parse failure).
 */
export async function callLLM(opts: LLMCallOptions): Promise<LLMCallResult> {
  if (!opts.apiUrl || !opts.apiKey || !opts.model) {
    throw new Error('AI 配置不完整：请确保 API 地址、Key 和模型名称均已填写')
  }

  const baseUrl = opts.apiUrl.replace(/\/+$/, '')
  const url = `${baseUrl}/chat/completions`

  const controller = new AbortController()
  const timeoutMs = opts.timeoutMs ?? 30000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let resp: NetResponse
  try {
    resp = await netFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.4,
        stream: false,
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {})
      }),
      signal: controller.signal
    })
  } catch (fetchErr) {
    clearTimeout(timeout)
    if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
      throw new Error(`AI 请求超时（${timeoutMs / 1000} 秒未响应），请检查网络或更换模型。`)
    }
    throw new Error(`AI 请求失败：${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`)
  }
  clearTimeout(timeout)

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`AI 请求失败 (${resp.status}): ${text.slice(0, 300)}`)
  }

  const json: { choices?: { message?: { content?: string }; finish_reason?: string }[] } =
    (await resp.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] }

  const content = json.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('AI 返回内容为空')
  }

  return {
    content,
    finishReason: json.choices?.[0]?.finish_reason,
    raw: json
  }
}
