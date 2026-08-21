/**
 * v1.25.1 verification: self-signed HTTPS (the classic intranet case where
 * the server really handles the request but Chromium rejects the response
 * certificate). Runs the compiled netFetch against a local HTTPS server:
 *   - default session        → expect CERT failure
 *   - dedicated session with setCertificateVerifyProc(cb(0)) → expect PASS
 *
 * Run:  npx electron scripts/debug-cert-test.cjs
 */
const https = require('https')
const fs = require('fs')
const path = require('path')
const { app, session } = require('electron')
const { netFetch } = require('../tmp/out-netfetch.cjs')

const PORT = 8443

function startHttpsServer() {
  return new Promise((resolve) => {
    const server = https.createServer(
      {
        key: fs.readFileSync(path.join(__dirname, '..', 'tmp', 'key.pem')),
        cert: fs.readFileSync(path.join(__dirname, '..', 'tmp', 'cert.pem'))
      },
      (req, res) => {
        // Server "handles" the request — exactly the reported symptom.
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ handled: true, path: req.url, note: 'self-signed intranet server' }))
      }
    )
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

async function runCase(name, url, options) {
  try {
    const resp = await netFetch(url, options)
    const body = await resp.text()
    console.log(`[PASS] ${name}: status=${resp.status} body=${body.slice(0, 70)}`)
  } catch (err) {
    console.log(`[FAIL] ${name}: ${err && err.message}`)
  }
}

app.whenReady().then(async () => {
  const server = await startHttpsServer()
  const url = `https://127.0.0.1:${PORT}/api/data`

  // 1. Default session (full cert verification) — expect the reported failure.
  await runCase('default session (strict)  ', url)

  // 2. Dedicated session mirroring ApiToolSettings.ignoreCert = true.
  const ses = session.fromPartition('api-tool', { cache: false })
  ses.setCertificateVerifyProc((_request, callback) => callback(0))
  await runCase('api-tool session ignoreCert', url, { session: ses })

  // 3. A FRESH session with strict verification (mirrors the app's
  //    generation-based recreation) — strict again, no pooled connection.
  const ses2 = session.fromPartition('api-tool-strict-check', { cache: false })
  await runCase('fresh strict session       ', url, { session: ses2 })

  server.close()
  app.quit()
})
