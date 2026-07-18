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
  json: () => Promise<unknown>
  text: () => Promise<string>
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
