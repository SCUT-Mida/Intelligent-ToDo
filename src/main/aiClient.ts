/**
 * Reusable LLM (OpenAI-compatible) chat completions client.
 *
 * Extracted from the aiRecommend function in src/main/index.ts.
 * Provides a generic callLLM() that any feature (Todo priority, Repo AI memory, etc.)
 * can use without duplicating HTTP/networking logic.
 *
 * v1.22 additions (patterns borrowed from deepseek-harness):
 *  - Streaming: pass `onDelta` to receive SSE text deltas as they arrive.
 *  - Retry with backoff: 429/5xx/network errors are retried (default 2x);
 *    auth/config errors (400/401/403) fail fast. Aborts are never retried.
 *  - Usage: responses expose token usage; pass `usageSource` to record it
 *    into the token meter automatically.
 */

import { netFetch, netFetchStream } from './netFetch'
import type { NetResponse } from './netFetch'
import { recordTokenUsage } from './tokenMeter'
import type { TokenUsage, TokenUsageSource } from './tokenMeter'
import { logger } from './logger'

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
  /** When provided, the call streams and each text delta is forwarded here. */
  onDelta?: (text: string) => void
  /** Max retry attempts for transient failures (429/5xx/network). Default 2. */
  maxRetries?: number
  /**
   * External cancellation (user cancel). When this fires the AbortError is
   * re-thrown as-is so callers can distinguish user-cancel from timeout.
   */
  signal?: AbortSignal
  /** When set, successful calls record token usage under this source label. */
  usageSource?: TokenUsageSource
}

export interface LLMCallResult {
  content: string
  finishReason?: string
  usage?: TokenUsage
  raw?: unknown
}

/** 429 + 5xx are transient; 4xx (other than 429) are caller/config mistakes. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

/** Backoff before retry N (1-based): 500ms, 1s, 2s… plus jitter. */
function backoffMs(retry: number): number {
  return 500 * Math.pow(2, retry - 1) + Math.floor(Math.random() * 250)
}

function parseUsage(raw: unknown): TokenUsage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const u = raw as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
  const pt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : undefined
  const ct = typeof u.completion_tokens === 'number' ? u.completion_tokens : undefined
  const tt = typeof u.total_tokens === 'number' ? u.total_tokens : undefined
  if (pt === undefined && ct === undefined && tt === undefined) return undefined
  return {
    promptTokens: pt ?? 0,
    completionTokens: ct ?? 0,
    totalTokens: tt ?? (pt ?? 0) + (ct ?? 0)
  }
}

interface StreamAccumulator {
  content: string
  finishReason?: string
  usage?: TokenUsage
}

/** Name used by net/netFetch for aborted requests. */
const ABORT_ERROR = 'AbortError'

/**
 * Call an OpenAI-compatible chat completions endpoint.
 *
 * @throws {Error} with Chinese messages on failure (missing config, network,
 *                 non-200 status, parse failure). User-cancel aborts surface
 *                 as an Error named AbortError when `opts.signal` fired.
 */
export async function callLLM(opts: LLMCallOptions): Promise<LLMCallResult> {
  if (!opts.apiUrl || !opts.apiKey || !opts.model) {
    throw new Error('AI 配置不完整：请确保 API 地址、Key 和模型名称均已填写')
  }

  const baseUrl = opts.apiUrl.replace(/\/+$/, '')
  const url = `${baseUrl}/chat/completions`
  const maxRetries = opts.maxRetries ?? 2
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.apiKey}`
  }

  const attempt = async (retry: number): Promise<LLMCallResult> => {
    // Own timeout controller, linked to the external cancel signal.
    const controller = new AbortController()
    const timeoutMs = opts.timeoutMs ?? 30000
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const onExternalAbort = (): void => controller.abort()
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort()
      else opts.signal.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      const result = opts.onDelta
        ? await streamOnce(url, headers, opts, controller.signal, retry)
        : await plainOnce(url, headers, opts, controller.signal)
      if (opts.usageSource) {
        recordTokenUsage(opts.usageSource, opts.model, result.usage)
      }
      return result
    } catch (err) {
      // Never retry aborts (user cancel or our own timeout).
      if (err instanceof Error && err.name === ABORT_ERROR) {
        if (opts.signal?.aborted) throw err // let the caller see the raw cancel
        throw new Error(`AI 请求超时（${timeoutMs / 1000} 秒未响应），请检查网络或更换模型。`)
      }
      // The 400-fallback for stream_options only applies on the first pass
      // of a streaming call — streamOnce handles it internally.

      if (retry < maxRetries && isRetryable(err)) {
        logger.warn('aiClient', 'transient LLM failure, retrying', {
          retry: retry + 1,
          ofMax: maxRetries,
          error: err instanceof Error ? err.message : String(err)
        })
        await new Promise((r) => setTimeout(r, backoffMs(retry + 1)))
        return attempt(retry + 1)
      }
      throw err
    } finally {
      clearTimeout(timeout)
      if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort)
    }
  }

  return attempt(0)
}

/** Errors eligible for retry: network failures or retryable HTTP statuses. */
function isRetryable(err: unknown): boolean {
  if (err instanceof Error && (err as Error & { httpStatus?: number }).httpStatus !== undefined) {
    return isRetryableStatus((err as Error & { httpStatus?: number }).httpStatus as number)
  }
  // Anything thrown before/without an HTTP status (fetch failure, DNS…) counts
  // as transient. Non-2xx with 4xx status carries httpStatus and is excluded
  // by the branch above.
  return true
}

/** Mark an error with its HTTP status so isRetryable can classify it. */
function statusError(status: number, text: string): Error {
  const err = new Error(`AI 请求失败 (${status}): ${text.slice(0, 300)}`)
  ;(err as Error & { httpStatus: number }).httpStatus = status
  return err
}

/** Non-streaming request (previous behavior). */
async function plainOnce(
  url: string,
  headers: Record<string, string>,
  opts: LLMCallOptions,
  signal: AbortSignal
): Promise<LLMCallResult> {
  let resp: NetResponse
  try {
    resp = await netFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.4,
        stream: false,
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {})
      }),
      signal
    })
  } catch (fetchErr) {
    throw fetchErr
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw statusError(resp.status, text)
  }

  const json = (await resp.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
    usage?: unknown
  }

  const content = json.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('AI 返回内容为空')
  }

  return {
    content,
    finishReason: json.choices?.[0]?.finish_reason,
    usage: parseUsage(json.usage),
    raw: json
  }
}

/**
 * Streaming (SSE) request. On the first pass we ask for usage via
 * stream_options.include_usage; endpoints that reject the parameter with a
 * 400 are retried once without it (usage then stays undefined).
 */
async function streamOnce(
  url: string,
  headers: Record<string, string>,
  opts: LLMCallOptions,
  signal: AbortSignal,
  retry: number
): Promise<LLMCallResult> {
  const buildBody = (withUsage: boolean): string =>
    JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.4,
      stream: true,
      ...(withUsage ? { stream_options: { include_usage: true } } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {})
    })

  const run = async (withUsage: boolean): Promise<LLMCallResult> => {
    const resp = await netFetchStream(url, {
      method: 'POST',
      headers,
      body: buildBody(withUsage),
      signal
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw statusError(resp.status, text)
    }

    const acc: StreamAccumulator = { content: '' }
    let buffer = ''
    for await (const chunk of resp.chunks) {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        consumeSseLine(line, acc, opts.onDelta)
      }
    }
    if (buffer) consumeSseLine(buffer.replace(/\r$/, ''), acc, opts.onDelta)

    if (!acc.content) {
      throw new Error('AI 返回内容为空')
    }
    return {
      content: acc.content,
      finishReason: acc.finishReason,
      usage: acc.usage,
      raw: undefined
    }
  }

  try {
    return await run(true)
  } catch (err) {
    const status = (err as Error & { httpStatus?: number }).httpStatus
    // First attempt only: endpoints that don't know stream_options answer 400.
    if (status === 400 && retry === 0) {
      logger.warn('aiClient', 'stream_options rejected (400), retrying without it')
      return run(false)
    }
    throw err
  }
}

/** Parse one SSE line (`data: {...}` / `data: [DONE]`) into the accumulator. */
function consumeSseLine(line: string, acc: StreamAccumulator, onDelta?: (t: string) => void): void {
  if (!line.startsWith('data:')) return
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return
  let json: {
    choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[]
    usage?: unknown
  }
  try {
    json = JSON.parse(payload)
  } catch {
    return // tolerate keep-alives / partial vendor extensions
  }
  const choice = json.choices?.[0]
  const delta = choice?.delta?.content
  if (typeof delta === 'string' && delta) {
    acc.content += delta
    onDelta?.(delta)
  }
  if (typeof choice?.finish_reason === 'string') {
    acc.finishReason = choice.finish_reason
  }
  const usage = parseUsage(json.usage)
  if (usage) acc.usage = usage
}
