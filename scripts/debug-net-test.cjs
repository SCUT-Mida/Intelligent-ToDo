/**
 * Reproduction harness for the API tool's "every request errors" report.
 *
 * Starts a plain Node HTTP server with representative endpoints, then runs
 * the EXACT src/main/netFetch.ts (compiled with esbuild) against each one
 * inside a real Electron main process. Prints one line per scenario.
 *
 * Run:  npx electron scripts/debug-net-test.cjs
 */
const http = require('http')
const zlib = require('zlib')
const { app } = require('electron')
const { netFetch } = require('../tmp/out-netfetch.cjs')

const PORT = 3999

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '/'
      if (url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ code: 0, msg: 'ok', data: { list: [1, 2, 3] } }))
      } else if (url === '/text') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('你好，纯文本响应 hello')
      } else if (url === '/echo' && req.method === 'POST') {
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ received: body, contentType: req.headers['content-type'] || null }))
        })
      } else if (url === '/404') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end('{"error":"not found"}')
      } else if (url === '/500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('internal error')
      } else if (url === '/204') {
        res.writeHead(204)
        res.end()
      } else if (url === '/chunked') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' })
        res.write('{"part":')
        setTimeout(() => {
          res.write('"two"}')
          res.end()
        }, 100)
      } else if (url === '/delay2') {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"ok":true}')
        }, 2000)
      } else if (url === '/big') {
        const payload = JSON.stringify({ blob: 'x'.repeat(1024 * 1024) })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(payload)
      } else if (url === '/gzip') {
        const body = zlib.gzipSync(JSON.stringify({ gz: true, note: 'compressed' }))
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
        res.end(body)
      } else if (url === '/hangup') {
        // Server answers headers, sends partial body, then destroys the
        // socket — mimics aggressive intranet gateway behavior.
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write('{"partial":')
        setTimeout(() => res.socket.destroy(), 50)
      } else if (url === '/close') {
        // HTTP/1.0-style: Connection: close, no content-length
        res.writeHead(200, { 'Content-Type': 'text/plain', Connection: 'close' })
        res.end('legacy close-mode body')
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ echoUrl: url, method: req.method, headers: req.headers }))
      }
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

async function runCase(name, url, options) {
  const t0 = Date.now()
  try {
    const resp = await netFetch(url, options)
    const body = await resp.text()
    const ms = Date.now() - t0
    console.log(
      `[PASS] ${name}: status=${resp.status} bytes=${Buffer.byteLength(body)} ms=${ms} body[0..60]=${body.slice(0, 60).replace(/\n/g, ' ')}`
    )
  } catch (err) {
    console.log(`[FAIL] ${name}: ${err && err.name === 'AbortError' ? 'AbortError' : ''} ${err && err.message}`)
  }
}

app.whenReady().then(async () => {
  const server = await startServer()
  const base = `http://127.0.0.1:${PORT}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  await runCase('GET /json        ', `${base}/json`)
  await runCase('GET /text (utf8) ', `${base}/text`)
  await runCase('GET /404         ', `${base}/404`)
  await runCase('GET /500         ', `${base}/500`)
  await runCase('GET /204 (empty) ', `${base}/204`)
  await runCase('GET /chunked     ', `${base}/chunked`)
  await runCase('GET /delay2      ', `${base}/delay2`)
  await runCase('GET /big (1MB)   ', `${base}/big`)
  await runCase('GET /gzip        ', `${base}/gzip`)
  await runCase('GET /close(1.0)  ', `${base}/close`)
  await runCase('GET /hangup      ', `${base}/hangup`)
  await runCase('POST /echo json  ', `${base}/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"a":1,"b":"中文"}'
  })
  await runCase('GET with params  ', `${base}/x?page=1&size=20`)
  await runCase('GET localhost    ', `http://localhost:${PORT}/json`)
  await runCase('GET with headers ', `${base}/json`, {
    headers: { Authorization: 'Bearer test-token', 'X-Custom': 'abc' }
  })

  clearTimeout(timeout)
  server.close()
  app.quit()
})
