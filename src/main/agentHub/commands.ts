/**
 * Agent Hub — slash-command discovery (config-scan fallback).
 *
 * PRIMARY source of the `/` palette is a LIVE terminal probe (see pty.ts
 * probeCommands): we inject `/` into the running agent and parse the menu it
 * renders itself. This file is the OFFLINE FALLBACK used when no PTY is
 * available — it scans the same Markdown command files the CLI would read:
 *
 *   opencode  &lt;workDir&gt;/.opencode/command               (project)
 *             ~/.config/opencode/command                 (global user)
 *             ~/.config/opencode/plugin                  (local plugins)
 *             ~/.config/opencode/node_modules            (npm plugins)
 *
 *   claude    &lt;workDir&gt;/.claude/commands                 (project)
 *             ~/.claude/commands                         (global user)
 *             ~/.claude/plugins                          (plugins)
 *
 * Command files are Markdown; the filename (path-relative, `/`-separated,
 * extension stripped) is the command name. The description comes from YAML
 * frontmatter `description` (fallback `title`, then the first text line).
 */

import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'
import { homedir } from 'os'
import { logger } from '../logger'
import type { AgentCommandDef } from '../../shared/agentHub'

/** Max recursion depth when searching a tree for `command`/`commands` dirs. */
const MAX_SCAN_DEPTH = 8

/**
 * Walk a tree and collect every directory named `command` or `commands`.
 * Depth-limited so marketplace plugin trees (which can be deep) stay bounded.
 */
function collectCommandDirs(root: string, maxDepth: number): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = join(dir, entry.name)
      if (/^commands?$/i.test(entry.name)) {
        found.push(full)
        // Still descend one level so nested command subfolders are found
        walk(full, depth + 1)
      } else if (depth < maxDepth) {
        walk(full, depth + 1)
      }
    }
  }
  walk(root, 0)
  return found
}

/** Read every *.md file under a command dir (recursively for nesting). */
function readCommandFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        files.push(full)
      }
    }
  }
  walk(root, 0)
  return files
}

/** Extract a short description from a command Markdown file. */
function parseCommandDescription(filePath: string): string {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
  // YAML frontmatter between --- markers
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (fm) {
    const field = (key: string): string | undefined =>
      fm[1].match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'))?.[1]?.trim()
    const description = field('description') ?? field('title')
    if (description) return description.replace(/^["']|["']$/g, '')
  }
  // Fallback: first non-empty line that is not a heading
  const line = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'))
  return (line ?? '').slice(0, 120)
}

/** Which filesystem sources to scan for a given agent command. */
function commandSources(agentCommand: string, workDir: string): string[] {
  const cmd = agentCommand.toLowerCase()
  const home = homedir()

  // 5-agent scope (user-specified):
  //   opencode / nga (opencode-based)  → opencode official config dirs
  //   claude / codeagent (claude-based)→ claude official config dirs
  //   hermes                          → hermes official config dirs
  if (cmd === 'nga' || cmd.includes('opencode')) {
    return [
      join(workDir, '.opencode', 'command'),
      join(home, '.config', 'opencode', 'command'),
      join(home, '.config', 'opencode', 'plugin'),
      join(home, '.config', 'opencode', 'node_modules')
    ]
  }
  if (cmd === 'codeagent' || cmd.includes('claude')) {
    return [
      join(workDir, '.claude', 'commands'),
      join(home, '.claude', 'commands'),
      join(home, '.claude', 'plugins')
    ]
  }
  if (cmd === 'hermes' || cmd.includes('hermes')) {
    return [
      join(workDir, '.hermes', 'commands'),
      join(home, '.hermes', 'commands'),
      join(home, '.config', 'hermes', 'command')
    ]
  }
  return []
}

/**
 * List the slash commands the given CLI agent supports. Returns an empty
 * array for unknown agents. Sorted by name, deduplicated (first source wins).
 */
export function listAgentCommands(agentCommand: string, workDir: string): AgentCommandDef[] {
  const collected: AgentCommandDef[] = []
  const seen = new Set<string>()

  const addDir = (commandDir: string): void => {
    for (const file of readCommandFiles(commandDir)) {
      const name = relative(commandDir, file).replace(/\.md$/i, '').split(sep).join('/')
      if (!name || seen.has(name)) continue
      seen.add(name)
      collected.push({ name, description: parseCommandDescription(file) })
    }
  }

  try {
    for (const source of commandSources(agentCommand, workDir)) {
      if (/[\\/](command|commands)$/i.test(source)) {
        // Direct command dir (project/global user commands)
        addDir(source)
      } else {
        // Plugin tree — search for command/commands dirs inside
        for (const dir of collectCommandDirs(source, MAX_SCAN_DEPTH)) {
          addDir(dir)
        }
      }
    }
  } catch (err) {
    logger.warn('agentHub:commands', 'discovery failed', {
      error: err instanceof Error ? err.message : String(err)
    })
  }

  return collected.sort((a, b) => a.name.localeCompare(b.name))
}
