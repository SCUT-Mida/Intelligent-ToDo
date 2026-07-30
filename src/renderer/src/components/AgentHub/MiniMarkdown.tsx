import { useState, useCallback } from 'react'

interface MiniMarkdownProps {
  content: string
}

/**
 * Minimal markdown renderer — zero external dependencies.
 * Parses line-by-line into React elements. All HTML is escaped by React.
 *
 * Supports: headings (#/##/###), bold (**text**), inline code (`code`),
 * fenced code blocks (```), bullet lists (-), numbered lists (1.),
 * links ([text](url)), paragraphs, line breaks.
 */
export default function MiniMarkdown({ content }: MiniMarkdownProps): JSX.Element {
  const parsed = parseMarkdown(content)
  return <div className="mini-md">{parsed}</div>
}

// ── Inline parsing ──────────────────────────────────────────────────────

/**
 * Parse inline formatting: **bold**, `code`, [links](url).
 * Returns an array of React nodes.
 */
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let idx = 0

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[2] !== undefined) {
      // Bold: **text**
      parts.push(<strong key={`${keyPrefix}b${idx}`}>{match[2]}</strong>)
    } else if (match[3] !== undefined) {
      // Inline code: `code`
      parts.push(<code key={`${keyPrefix}c${idx}`}>{match[3]}</code>)
    } else if (match[4] !== undefined && match[5] !== undefined) {
      // Link: [text](url)
      const url = match[5]
      // Sanitise — only http/https/mailto, prevent javascript: etc
      const safeUrl = url.match(/^(https?:\/\/|mailto:)/i) ? url : url.replace(/^javascript:/i, '')
      parts.push(
        <a key={`${keyPrefix}l${idx}`} href={safeUrl} target="_blank" rel="noopener noreferrer">
          {match[4]}
        </a>
      )
    }

    lastIndex = match.index + match[0].length
    idx++
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

// ── Line-level parsing ──────────────────────────────────────────────────

interface CodeBlockState {
  active: boolean
  lang: string
  lines: string[]
}

type LineType =
  | { type: 'heading'; level: number; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'ordered'; number: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'empty' }
  | { type: 'hr' }
  | { type: 'code-fence-open'; lang: string }
  | { type: 'code-fence-close' }
  | { type: 'code-line'; text: string }

function classifyLine(raw: string): LineType {
  const trimmed = raw.trimEnd()

  // Code fence
  if (/^```(\w*)/.test(trimmed)) {
    const lang = trimmed.replace(/^```(\w*).*/, '$1') || ''
    return { type: 'code-fence-open', lang }
  }

  // Heading
  const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
  if (headingMatch) {
    return { type: 'heading', level: headingMatch[1].length, text: headingMatch[2] }
  }

  // Horizontal rule
  if (/^(-{3,}|\*{3,})$/.test(trimmed.trim())) {
    return { type: 'hr' }
  }

  // Bullet list
  const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/)
  if (bulletMatch) {
    return { type: 'bullet', text: bulletMatch[1] }
  }

  // Ordered list
  const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/)
  if (orderedMatch) {
    return { type: 'ordered', number: parseInt(orderedMatch[1], 10), text: orderedMatch[2] }
  }

  // Empty
  if (trimmed === '') {
    return { type: 'empty' }
  }

  // Default: paragraph
  return { type: 'paragraph', text: trimmed }
}

// ── Root parser ─────────────────────────────────────────────────────────

interface ListAccum {
  type: 'ul' | 'ol'
  items: React.ReactNode[][]
  key: string
}

function parseMarkdown(content: string): React.ReactNode[] {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let elementKey = 0

  let codeBlock: { lang: string; lines: string[] } | null = null
  let listAccum: ListAccum | null = null

  function flushList(): void {
    const acc = listAccum
    if (!acc) return
    const Tag = acc.type === 'ul' ? 'ul' : 'ol'
    elements.push(
      <Tag key={`list-${elementKey++}`}>
        {acc.items.map((itemLines, i) => (
          <li key={`li-${acc.key}-${i}`}>
            {itemLines.map((node, j) => (
              <span key={`${acc.key}-${i}-${j}`}>{node}</span>
            ))}
          </li>
        ))}
      </Tag>
    )
    listAccum = null
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]

    // Handle code block
    if (codeBlock) {
      if (/^```/.test(raw.trim())) {
        // Close code block
        elements.push(
          <CodeBlockRenderer
            key={`code-${elementKey++}`}
            lang={codeBlock.lang}
            code={codeBlock.lines.join('\n')}
          />
        )
        codeBlock = null
      } else {
        codeBlock.lines.push(raw)
      }
      continue
    }

    if (/^```(\w*)/.test(raw.trim())) {
      // Open code block
      flushList()
      const lang = raw.trim().replace(/^```(\w*).*/, '$1') || ''
      codeBlock = { lang, lines: [] }
      continue
    }

    const line = classifyLine(raw)

    switch (line.type) {
      case 'heading': {
        flushList()
        const Tag = line.level === 1 ? 'h1' : line.level === 2 ? 'h2' : 'h3'
        elements.push(
          <Tag key={`h-${elementKey++}`}>{parseInline(line.text, `h${elementKey}`)}</Tag>
        )
        break
      }

      case 'bullet': {
        let acc: ListAccum | null = listAccum
        if (!acc || acc.type !== 'ul') {
          flushList()
          acc = { type: 'ul', items: [], key: `ul-${elementKey++}` }
          listAccum = acc
        }
        acc.items.push(parseInline(line.text, `li-${acc.key}-${acc.items.length}`))
        break
      }

      case 'ordered': {
        let acc: ListAccum | null = listAccum
        if (!acc || acc.type !== 'ol') {
          flushList()
          acc = { type: 'ol', items: [], key: `ol-${elementKey++}` }
          listAccum = acc
        }
        acc.items.push(parseInline(line.text, `li-${acc.key}-${acc.items.length}`))
        break
      }

      case 'paragraph': {
        flushList()
        elements.push(
          <p key={`p-${elementKey++}`}>{parseInline(line.text, `p${elementKey}`)}</p>
        )
        break
      }

      case 'empty': {
        flushList()
        break
      }

      case 'hr': {
        flushList()
        elements.push(<hr key={`hr-${elementKey++}`} />)
        break
      }
    }
  }

  // Flush remaining
  flushList()
  if (codeBlock) {
    // Unclosed code block — render what we have
    elements.push(
      <CodeBlockRenderer
        key={`code-${elementKey++}`}
        lang={codeBlock.lang}
        code={codeBlock.lines.join('\n')}
      />
    )
  }

  if (elements.length === 0) {
    elements.push(<p key="empty">{content}</p>)
  }

  return elements
}

// ── Code block component (with copy button) ─────────────────────────────

function CodeBlockRenderer({ lang, code }: { lang: string; code: string }): JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [code])

  return (
    <div className="mini-md__code-block">
      <div className="mini-md__code-header">
        <span>{lang || 'code'}</span>
        <button onClick={handleCopy}>{copied ? '已复制 ✓' : '复制'}</button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}
