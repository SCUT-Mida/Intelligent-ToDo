/**
 * Reproduction for "scheduled pty run completes but result is invisible".
 * Runs a pty-mode task (cmd /c echo …) via the REAL taskRunner, waits for
 * the notify-bus settlement, then reads back the session event log through
 * the same loadSessionEvents path the 📄 结果 button uses.
 *
 * Run: npx electron scripts/debug-pty-task-test.cjs
 */
const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const { runTask } = require('../tmp/out-taskrunner.cjs')
const { notifyBus } = require('../tmp/out-notify.cjs')
const { loadSessionEvents } = require('../tmp/out-eventlog.cjs')

app.whenReady().then(async () => {
  const sessionId = 'sched-debugtest'

  const done = new Promise((resolve) => {
    notifyBus.on('notify', (n) => {
      console.log(`[NOTIFY] kind=${n.kind} runId=${n.runId} body=${(n.body || '').slice(0, 80)}`)
      if (n.sessionId === sessionId) resolve()
    })
  })

  const started = runTask(null, {
    sessionId,
    command: 'cmd',
    outputMode: 'generic',
    args: '/c echo HELLO-FROM-PTY-TEST',
    workDir: 'C:\\',
    prompt: '这个提示词不应被当作目录或参数',
    background: true,
    mode: 'pty'
  })
  console.log(`[START] ok=${started.ok} runId=${started.runId} error=${started.error ?? '-'}`)
  if (!started.ok) {
    app.quit()
    return
  }

  await Promise.race([done, new Promise((r) => setTimeout(r, 30000))])
  // Small grace for the final append.
  await new Promise((r) => setTimeout(r, 500))

  const events = loadSessionEvents(sessionId)
  console.log(`[EVENTS] count=${events.length}`)
  for (const e of events) {
    console.log(
      `  seq=${e.seq} type=${e.type}` +
        (e.text ? ` text[0..80]=${e.text.slice(0, 80).replace(/\n/g, ' | ')}` : '') +
        (e.result ? ` result[0..80]=${e.result.slice(0, 80).replace(/\n/g, ' | ')}` : '')
    )
  }

  const lastFinish = [...events].reverse().find((e) => e.type === 'run_finished')
  console.log(
    lastFinish
      ? `[RESULT-VISIBLE] yes — ${lastFinish.result?.slice(0, 100) ?? '(empty result field)'}`
      : '[RESULT-VISIBLE] NO — no run_finished event found'
  )

  app.quit()
})
