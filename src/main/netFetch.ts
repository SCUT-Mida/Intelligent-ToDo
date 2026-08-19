/**
 * Proxy-aware HTTP fetch via Electron's net module.
 *
 * Extracted from src/main/index.ts into a reusable module.
 * Node's global `fetch` (undici) does NOT use the system proxy, so all
 * network requests fail on corporate networks. Electron's `net` module
 * goes through Chromium's network stack, which respects system proxy
 * settings automatically. This wrapper mimics the fetch API.
 */

import { net } from 'electron'

export interface NetResponse {
  ok: boolean
  status: number
  /** Response headers (multi-values joined with ', '). v1.25: needed by the API tool. */
  headers: Record<string, string>
  json: () => Promise<unknown>
  text: () => Promise<string>
}

/**
 * Streaming variant of NetResponse for SSE / chunked responses.
 * `chunks` yields decoded UTF-8 text pieces as they arrive; `text()`
 * resolves with the full body once the stream ends.
 */
export interface NetStreamResponse {
  ok: boolean
  status: number
  headers: Record<string, string>
  chunks: AsyncIterable<string>
  text: () => Promise<string>
}

/** Flatten Electron's response headers (string | string[] values) into a plain map. */
function flattenHeaders(raw: Record<string, string | string[]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    out[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}

/**
 * Streaming fetch — like netFetch but exposes body chunks as they arrive
 * (needed for SSE). UTF-8 is decoded with a streaming TextDecoder so
 * multi-byte characters split across chunk boundaries stay intact.
 *
 * The request is aborted (and the iterator ends) if `signal` fires.
 */
export function netFetchStream(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}
): Promise<NetStreamResponse> {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: options.method ?? 'GET', url })

    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        request.setHeader(key, value)
      }
    }

    const onAbort = (): void => request.abort()
    if (options.signal) {
      if (options.signal.aborted) {
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
        return
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    request.on('response', (response) => {
      const status = response.statusCode
      const decoder = new TextDecoder('utf-8')
      // Full-body accumulation (for text()) — bounded by callers' max_tokens.
      let full = ''
      let done = false
      let failure: Error | null = null
      const queue: string[] = []
      let waiter: (() => void) | null = null
      let fullWaiters: Array<() => void> = []

      const settleWaiters = (): void => {
        const w = waiter
        waiter = null
        if (w) w()
      }

      response.on('data', (chunk: Buffer) => {
        const text = decoder.decode(chunk, { stream: true })
        if (!text) return
        full += text
        queue.push(text)
        settleWaiters()
      })
      response.on('end', () => {
        // Flush any pending bytes (multi-byte tails) into the stream.
        const tail = decoder.decode()
        if (tail) {
          full += tail
          queue.push(tail)
        }
        done = true
        if (options.signal) options.signal.removeEventListener('abort', onAbort)
        settleWaiters()
        const waiters = fullWaiters
        fullWaiters = []
        for (const w of waiters) w()
      })
      response.on('error', (err: Error) => {
        failure = err
        done = true
        if (options.signal) options.signal.removeEventListener('abort', onAbort)
        settleWaiters()
        const waiters = fullWaiters
        fullWaiters = []
        for (const w of waiters) w()
      })

      const chunks: AsyncIterable<string> = {
        async *[Symbol.asyncIterator](): AsyncIterator<string> {
          for (;;) {
            while (queue.length > 0) {
              const item = queue.shift()
              if (item !== undefined) yield item
            }
            if (done) {
              if (failure) throw failure
              return
            }
            await new Promise<void>((r) => {
              waiter = r
            })
          }
        }
      }

      resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: flattenHeaders(response.headers),
        chunks,
        text: () =>
          done
            ? Promise.resolve(full)
            : new Promise<string>((res, rej) => {
                fullWaiters.push(() => (failure ? rej(failure) : res(full)))
              })
      })
    })

    request.on('error', (err: Error) => {
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
      if (options.signal?.aborted) {
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      } else {
        reject(err)
      }
    })

    if (options.body) request.write(options.body)
    request.end()
  })
}

export function netFetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}
): Promise<NetResponse> {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: options.method ?? 'GET', url })

    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        request.setHeader(key, value)
      }
    }

    const onAbort = (): void => request.abort()
    if (options.signal) {
      if (options.signal.aborted) {
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
        return
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        if (options.signal) options.signal.removeEventListener('abort', onAbort)
        const bodyStr = Buffer.concat(chunks).toString('utf-8')
        const status = response.statusCode
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: flattenHeaders(response.headers),
          json: () => Promise.resolve(JSON.parse(bodyStr)),
          text: () => Promise.resolve(bodyStr)
        })
      })
      response.on('error', (err: Error) => {
        if (options.signal) options.signal.removeEventListener('abort', onAbort)
        reject(err)
      })
    })

    request.on('error', (err: Error) => {
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
      if (options.signal?.aborted) {
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      } else {
        reject(err)
      }
    })

    if (options.body) request.write(options.body)
    request.end()
  })
}
