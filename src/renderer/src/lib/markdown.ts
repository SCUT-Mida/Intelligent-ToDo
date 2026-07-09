import type { Task, Quadrant } from '@shared/types'
import { QUADRANTS, getQuadrantMeta } from '@shared/types'

/** Generate a full Markdown document of all tasks grouped by quadrant. */
export function generateMarkdown(tasks: Task[]): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const generatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

  const total = tasks.length
  const done = tasks.filter((t) => t.completed).length
  const pending = total - done

  const lines: string[] = []
  lines.push('# 待办事项总览')
  lines.push('')
  lines.push(`> 生成时间：${generatedAt}`)
  lines.push(`> 任务总数：${total}　已完成：${done}　待办：${pending}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  const chineseNum: Record<Quadrant, string> = {
    q1: '一',
    q2: '二',
    q3: '三',
    q4: '四'
  }

  for (const q of QUADRANTS) {
    const list = tasks.filter((t) => t.quadrant === q.id)
    lines.push(`## ${chineseNum[q.id]}、${q.title}（${q.subtitle}）`)
    lines.push('')
    if (list.length === 0) {
      lines.push('_暂无任务_')
      lines.push('')
      continue
    }
    // sort: incomplete first, then by due date asc (null last)
    const sorted = [...list].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate.localeCompare(b.dueDate)
    })
    for (const t of sorted) {
      const check = t.completed ? '[x]' : '[ ]'
      const due = t.dueDate ? ` （截止：${t.dueDate}）` : ''
      lines.push(`- ${check} ${t.content}${due}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push('_由 智能化代办 生成_')
  return lines.join('\n')
}

/** Default file name for export, with today's date. */
export function defaultMdFileName(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `todo-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.md`
}

/** Format a markdown recommendation into display lines (lightweight). */
export function splitRecommendation(md: string): string {
  return md.trim()
}
