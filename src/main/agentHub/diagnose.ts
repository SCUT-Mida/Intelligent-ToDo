/**
 * Session environment diagnosis (v1.25.3).
 *
 * When an agent behaves differently inside the embedded PTY than in a normal
 * terminal (e.g. a Claude-Code-based wrapper whose model whitelist is bound
 * to the git repo), the difference lives in the process ENVIRONMENT, not in
 * any interception — the PTY is a real ConPTY with full filesystem access.
 *
 * This probe reproduces exactly what the agent sees: every exec below runs
 * with the SAME env buildPtyEnv() would pass to the PTY, so failures here
 * are failures the agent would hit.
 *
 * Checks: agent command resolution, workDir/.git presence, git resolution
 * (where.exe with PTY env), git repo root + remote URL, TERM/FORCE_COLOR
 * forcing, Git dirs in PATH, and cmd.exe AutoRun hooks (a corporate env
 * injection point our direct-node spawn skips).
 */

import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { EnvDiagnosisResult, EnvDiagnosisRow } from '../../shared/agentHub'
import { buildSpawnTarget, buildPtyEnv } from './pty'
import { rebuildRegistryPath, splitPathEntries, mergePathEntries } from './winEnv'
import { getToolPaths } from '../toolPaths'
import { existsSync as toolExists } from 'fs'
import { logger } from '../logger'
import { app } from 'electron'

function run(
  cmd: string,
  args: string[],
  env: Record<string, string>
): { ok: boolean; out: string } {
  try {
    const r = spawnSync(cmd, args, {
      encoding: 'utf-8',
      timeout: 8000,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (r.error) return { ok: false, out: r.error.message }
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
    return { ok: r.status === 0, out: out.slice(0, 500) }
  } catch (err) {
    return { ok: false, out: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Run the diagnosis for one session environment.
 * @param command the agent command (as stored on the session/agent)
 * @param workDir the session's working directory
 */
export function diagnoseEnvironment(command: string, workDir: string): EnvDiagnosisResult {
  const rows: EnvDiagnosisRow[] = []
  const env = buildPtyEnv()

  // 1. Agent command resolution (the exact spawn target a PTY would use).
  try {
    const target = buildSpawnTarget(command)
    rows.push({
      label: 'Agent 解析目标',
      value: `${target.file} ${target.args.join(' ')}`.trim(),
      ok: null
    })
  } catch (err) {
    rows.push({
      label: 'Agent 解析目标',
      value: `解析失败：${err instanceof Error ? err.message : String(err)}`,
      ok: false
    })
  }

  // 2. WorkDir + .git presence.
  rows.push({
    label: '工作目录',
    value: workDir || '(空)',
    ok: workDir ? existsSync(workDir) : false
  })
  rows.push({
    label: '目录下存在 .git',
    value: existsSync(join(workDir, '.git')) ? '是' : '否（不是 git 仓库根/子目录）',
    ok: existsSync(join(workDir, '.git'))
  })

  // 3. git resolution through the PTY env's PATH.
  const whereGit = run('where', ['git'], env)
  const gitPath = whereGit.ok ? whereGit.out.split(/\r?\n/)[0]?.trim() ?? '' : ''
  rows.push({
    label: 'git 可解析（PTY 环境 PATH）',
    value: whereGit.ok ? gitPath : `不可解析：${whereGit.out || 'where 找不到 git'}`,
    ok: whereGit.ok
  })

  // 3b. node resolution (v1.25.4) — agent-side hooks/MCP shell out to `node`;
  // a failure here reproduces "SessionStart hook error: node: command not found".
  const whereNode = run('where', ['node'], env)
  rows.push({
    label: 'node 可解析（PTY 环境 PATH）',
    value: whereNode.ok
      ? whereNode.out.split(/\r?\n/)[0]?.trim() ?? ''
      : `不可解析：${whereNode.out || 'where 找不到 node（钩子/MCP 将失败）'}`,
    ok: whereNode.ok
  })

  if (gitPath) {
    const version = run(gitPath, ['--version'], env)
    rows.push({ label: 'git 版本', value: version.out || '(无输出)', ok: version.ok })

    // 4. Repo identification — what repo-bound whitelists key on.
    const toplevel = run(gitPath, ['-C', workDir, 'rev-parse', '--show-toplevel'], env)
    rows.push({
      label: 'git 仓库根（rev-parse --show-toplevel）',
      value: toplevel.out || '(失败)',
      ok: toplevel.ok
    })
    const remote = run(gitPath, ['-C', workDir, 'config', '--get', 'remote.origin.url'], env)
    rows.push({
      label: 'remote.origin.url',
      value: remote.ok ? remote.out : '(无 origin 或读取失败)',
      ok: remote.ok
    })
  }

  // 5. Env forcing we apply (documented differences vs a plain terminal).
  rows.push({ label: 'TERM（本工具强制）', value: env.TERM ?? '(未设置)', ok: null })
  rows.push({ label: 'FORCE_COLOR（本工具强制）', value: env.FORCE_COLOR ?? '(未设置)', ok: null })

  // 6. Git dirs present in the effective PATH.
  const gitInPath = (env.PATH ?? '').toLowerCase().includes('git')
  rows.push({
    label: 'PATH 中含 Git 目录',
    value: gitInPath ? '是' : '否',
    ok: gitInPath
  })

  // 6b. Registry PATH rebuild (v1.25.5): how many entries the effective PATH
  // gains over the app's own (possibly sanitized) PATH.
  const rebuilt = rebuildRegistryPath()
  const ownCount = splitPathEntries(process.env.PATH ?? '').length
  const effectiveCount = splitPathEntries(mergePathEntries(process.env.PATH ?? '', rebuilt)).length
  rows.push({
    label: '注册表 PATH 重建（机器+用户级）',
    value: rebuilt
      ? `注册表 ${splitPathEntries(rebuilt).length} 条；应用自带 ${ownCount} 条；合并后 ${effectiveCount} 条（新增 ${Math.max(0, effectiveCount - ownCount)}）`
      : '注册表不可读（保持应用自带 PATH）',
    ok: rebuilt ? null : false
  })

  // 6c. User-pinned common tool paths (设置 → 通用 → 工具路径).
  const pinned = getToolPaths()
  for (const [name, p] of [['git', pinned.git], ['node', pinned.node]] as const) {
    if (!p) {
      rows.push({ label: `通用工具路径 · ${name}`, value: '未配置（自动解析）', ok: null })
    } else {
      const usable = toolExists(p)
      rows.push({
        label: `通用工具路径 · ${name}`,
        value: usable ? p : `${p}（文件不存在）`,
        ok: usable
      })
    }
  }

  // 7. cmd.exe AutoRun hooks — corporate env-injection points that our
  // direct-node spawn (bypassing cmd.exe) would skip.
  for (const scope of ['HKCU', 'HKLM']) {
    const reg = run('reg', ['query', `${scope}\\Software\\Microsoft\\Command Processor`, '/v', 'AutoRun'], env)
    rows.push({
      label: `cmd AutoRun（${scope}）`,
      value: reg.ok ? reg.out : '未设置',
      ok: null
    })
  }

  logger.info('agentHub:diagnose', 'environment diagnosis completed', {
    command,
    workDir,
    rows: rows.length
  })

  return {
    at: new Date().toISOString(),
    appVersion: app.getVersion(),
    rows
  }
}
