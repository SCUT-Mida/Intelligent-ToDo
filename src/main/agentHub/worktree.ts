/**
 * AgentHub — git worktree isolation (v1.27).
 *
 * Lets multiple agent tasks run against one repo in parallel: each task gets
 * a sibling `git worktree` checkout with its own task branch. The merge
 * action implements the "直推" (direct-push maintainer) flow:
 *   worktree 内 rebase 到主仓当前分支 → 主仓 merge --ff-only（线性历史）→ 可选 push
 * Conflicts during rebase are auto-aborted (worktree stays intact) and
 * reported so the user can resolve in the embedded terminal.
 *
 * All git invocations go through effectiveGitBinary() (通用工具路径 → PATH).
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { basename, dirname, isAbsolute, join } from 'path'
import { existsSync, rmSync } from 'fs'
import type { SessionWorktree, WorktreeCreateResult, WorktreeMergeResult, WorktreeRemoveOptions, WorktreeRemoveResult } from '../../shared/agentHub'
import { slugifyBranchSuffix, worktreeDirName, worktreeBranchName } from '../../shared/worktreeUtils'
import { effectiveGitBinary } from '../toolPaths'
import { logger } from '../logger'

const execFileAsync = promisify(execFile)

interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

async function git(args: string[], cwd?: string): Promise<GitResult> {
  const binary = effectiveGitBinary()
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      cwd,
      timeout: 60000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    })
    return { ok: true, stdout, stderr }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) }
  }
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

function firstLine(s: string): string {
  return s.trim().split(/\r?\n/)[0] ?? ''
}

/**
 * Create a sibling worktree with a fresh task branch for the given repo.
 * @param repoPath must be an existing git repo (its checkout keeps the main branch)
 * @param slugSeed free-form task title; non-ASCII titles fall back to a timestamp slug
 */
export async function createWorktree(repoPath: string, slugSeed: string): Promise<WorktreeCreateResult> {
  if (!repoPath || !existsSync(join(repoPath, '.git'))) {
    return fail('目标目录不是 git 仓库（未找到 .git），无法创建隔离工作树')
  }
  const repoName = basename(repoPath)
  const slug = slugifyBranchSuffix(slugSeed) || `t${Date.now().toString(36)}`
  const branch = worktreeBranchName(slug)
  const path = join(dirname(repoPath), worktreeDirName(repoName, slug))

  if (existsSync(path)) {
    return fail(`工作树目录已存在：${path}。请更换任务标题，或先清理旧工作树。`)
  }

  // Same branch cannot be checked out twice; also avoid colliding names.
  const branchExists = await git(['rev-parse', '--verify', branch], repoPath)
  if (branchExists.ok) {
    return fail(`分支 ${branch} 已存在。请在终端处理旧分支后重试，或更换任务标题。`)
  }

  const add = await git(['worktree', 'add', path, '-b', branch], repoPath)
  if (!add.ok) {
    logger.error('agentHub:worktree', 'worktree add failed', { repoPath, path, branch, stderr: firstLine(add.stderr) })
    return fail(`创建工作树失败：${firstLine(add.stderr) || 'git worktree add 异常'}`)
  }

  logger.info('agentHub:worktree', 'worktree created', { repoPath, path, branch })
  return { ok: true, repoPath, branch, path }
}

/**
 * "直推" merge: rebase the task branch onto the repo's checked-out branch,
 * then fast-forward the main checkout (--ff-only keeps linear history, no
 * merge commit), optionally pushing to origin.
 */
export async function mergeWorktree(
  worktree: SessionWorktree,
  autoPush: boolean
): Promise<WorktreeMergeResult> {
  const { repoPath, branch, path } = worktree
  if (!existsSync(path)) {
    return fail('工作树目录不存在（可能已被删除）')
  }

  // 0. Worktree must be clean — rebase refuses dirty trees.
  const status = await git(['status', '--porcelain'], path)
  if (!status.ok) {
    return fail(`读取工作树状态失败：${firstLine(status.stderr)}`)
  }
  if (status.stdout.trim() !== '') {
    return fail('工作树有未提交的改动。请先让 agent 提交（或在终端手动提交）后再合并。')
  }

  // 1. The base branch = whatever the MAIN checkout has checked out
  //    (master / main / …). Fast-forward requires it.
  const head = await git(['symbolic-ref', '--short', 'HEAD'], repoPath)
  if (!head.ok) {
    return fail(`读取主仓当前分支失败：${firstLine(head.stderr)}`)
  }
  const baseBranch = firstLine(head.stdout)
  if (!baseBranch) {
    return fail('主仓当前处于分离 HEAD 状态，无法快进合并。请先在主仓检出目标分支。')
  }

  // How many commits will land (for the result summary).
  const count = await git(['rev-list', '--count', `${baseBranch}..${branch}`], repoPath)
  const mergedCount = count.ok ? parseInt(firstLine(count.stdout), 10) || 0 : 0

  // 2. Rebase task branch onto base (in the worktree).
  const rebase = await git(['rebase', baseBranch], path)
  if (!rebase.ok) {
    // Auto-abort so the worktree isn't left mid-rebase; user resolves in
    // the terminal and retries the merge.
    await git(['rebase', '--abort'], path)
    logger.warn('agentHub:worktree', 'rebase conflict, aborted', { repoPath, branch })
    return {
      ok: false,
      conflict: true,
      error: `变基到 ${baseBranch} 时遇到冲突，已自动中止（工作树完好）。请在嵌入式终端解决冲突后手动完成，或稍后重试合并。`
    }
  }

  // 3. Fast-forward the main checkout. If base moved between rebase and
  //    merge, ff-only fails — rebase once more, then merge again.
  let merge = await git(['merge', '--ff-only', branch], repoPath)
  if (!merge.ok) {
    const retryRebase = await git(['rebase', baseBranch], path)
    if (retryRebase.ok) {
      merge = await git(['merge', '--ff-only', branch], repoPath)
    }
  }
  if (!merge.ok) {
    return fail(`快进合并失败：${firstLine(merge.stderr) || '请稍后重试'}`)
  }

  // 4. Optional direct push (maintainer flow).
  let pushed = false
  if (autoPush) {
    const push = await git(['push', 'origin', baseBranch], repoPath)
    if (!push.ok) {
      return {
        ok: true,
        pushed: false,
        mergedCount,
        error: `已合并到本地 ${baseBranch}，但推送失败：${firstLine(push.stderr)}`
      }
    }
    pushed = true
  }

  logger.info('agentHub:worktree', 'merged', { repoPath, branch, baseBranch, mergedCount, pushed })
  return { ok: true, pushed, mergedCount }
}

/**
 * Remove the worktree and optionally its task branch. Refuses dirty
 * worktrees unless force is set.
 *
 * Self-healing (v1.27.1): when the worktree directory has already vanished
 * from disk (manual delete in Explorer, external cleanup tools), plain
 * `git worktree remove` fails with "'<path>' is not a working tree" because
 * realpath validation needs the directory to exist. In that case we
 * `git worktree prune` the stale registration and delete any leftover
 * directory ourselves — the user's intent (clean it up) is fulfilled, not
 * reported as an error.
 */
export async function removeWorktree(
  worktree: SessionWorktree,
  opts: WorktreeRemoveOptions
): Promise<WorktreeRemoveResult> {
  const { repoPath, branch, path } = worktree
  let removed = false

  if (existsSync(path)) {
    const remove = await git(['worktree', 'remove', ...(opts.force ? ['--force'] : []), path], repoPath)
    if (remove.ok) {
      removed = true
    } else if (/is not a working tree|does not exist/i.test(remove.stderr)) {
      // Directory gone / stale registration — healed below.
      logger.warn('agentHub:worktree', 'stale worktree registration, healing', { path })
    } else {
      const dirty = /dirty|modified|untracked/i.test(remove.stderr)
      return {
        ok: false,
        error: dirty
          ? '工作树有未提交/未跟踪的改动，拒绝删除。确认不要了可勾选「强制删除」重试。'
          : `删除工作树失败：${firstLine(remove.stderr)}`
      }
    }
  }

  // Prune stale registrations (missing directories) either way.
  const prune = await git(['worktree', 'prune'], repoPath)
  if (!prune.ok) {
    logger.warn('agentHub:worktree', 'worktree prune failed', { stderr: firstLine(prune.stderr) })
  }
  // Remove any leftover directory that the plain remove missed.
  if (!removed && existsSync(path)) {
    try {
      rmSync(path, { recursive: true, force: true })
    } catch (err) {
      logger.warn('agentHub:worktree', 'leftover removal failed', {
        path,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  if (opts.deleteBranch) {
    // -D: the user explicitly asked; -d would refuse on unmerged branches.
    const del = await git(['branch', '-D', branch], repoPath)
    if (!del.ok) {
      logger.warn('agentHub:worktree', 'branch delete failed', { branch, stderr: firstLine(del.stderr) })
      return { ok: true, error: `工作树已删除，但分支 ${branch} 删除失败：${firstLine(del.stderr)}` }
    }
  }

  logger.info('agentHub:worktree', 'worktree removed', { repoPath, path, branch: opts.deleteBranch ? branch : '(kept)' })
  return { ok: true }
}

/** Whether an absolute path looks like a usable executable (for UI hints). */
export function isUsableBinary(p: string | undefined): boolean {
  return !!p && isAbsolute(p) && existsSync(p)
}
