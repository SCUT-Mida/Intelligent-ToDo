/**
 * Self-contained, dependency-free Markdown → JSX renderer for the AgentHub
 * preview pane. Builds React elements directly (no dangerouslySetInnerHTML),
 * following the same philosophy as the GuideModal renderer but with broader
 * block support: ATX headings (# … ####), unordered/ordered lists, blockquotes,
 * fenced code blocks, horizontal rules, paragraphs, and inline bold / italic /
 * inline code / sanitized links.
 *
 * The renderer is deliberately lenient: malformed or unmatched markers fall
 * back to literal text and it never throws on arbitrary input.
 */

interface InlinePart {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link'
  content: string
  url?: string
}

/** Only http://, https:// and mailto: links are allowed; everything else is dropped. */
function sanitizeUrl(raw: string): string | null {
  const url = raw.trim()
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url
  return null
}

/**
 * Render the inline syntax of a single text run to JSX: **bold**, *italic*,
 * `inline code` and [text](url) links. Markers that cannot be closed (or links
 * with a disallowed scheme) are treated as literal text.
 */
function renderInline(text: string): JSX.Element {
  const parts: InlinePart[] = []
  let remaining = text

  while (remaining.length > 0) {
    // Inline code: `…`
    if (remaining.startsWith('`')) {
      const end = remaining.indexOf('`', 1)
      if (end !== -1) {
        parts.push({ type: 'code', content: remaining.slice(1, end) })
        remaining = remaining.slice(end + 1)
        continue
      }
    }

    // Bold: **…**
    if (remaining.startsWith('**')) {
      const end = remaining.indexOf('**', 2)
      if (end !== -1) {
        parts.push({ type: 'bold', content: remaining.slice(2, end) })
        remaining = remaining.slice(end + 2)
        continue
      }
    }

    // Italic: *…*
    if (remaining.startsWith('*')) {
      const end = remaining.indexOf('*', 1)
      if (end !== -1) {
        parts.push({ type: 'italic', content: remaining.slice(1, end) })
        remaining = remaining.slice(end + 1)
        continue
      }
    }

    // Link: [label](url) — only when the URL passes scheme sanitization
    if (remaining.startsWith('[')) {
      const closeBracket = remaining.indexOf(']')
      if (closeBracket !== -1 && remaining[closeBracket + 1] === '(') {
        const closeParen = remaining.indexOf(')', closeBracket + 2)
        if (closeParen !== -1) {
          const url = sanitizeUrl(remaining.slice(closeBracket + 2, closeParen))
          if (url !== null) {
            parts.push({ type: 'link', content: remaining.slice(1, closeBracket), url })
            remaining = remaining.slice(closeParen + 1)
            continue
          }
        }
      }
    }

    // Plain text run up to the next special character
    const next = remaining.search(/[`*[\]]/)
    if (next === -1) {
      parts.push({ type: 'text', content: remaining })
      remaining = ''
    } else if (next > 0) {
      parts.push({ type: 'text', content: remaining.slice(0, next) })
      remaining = remaining.slice(next)
    } else {
      // A lone special character that did not form a token stays literal
      parts.push({ type: 'text', content: remaining[0] })
      remaining = remaining.slice(1)
    }
  }

  return (
    <>
      {parts.map((part, i) => {
        switch (part.type) {
          case 'bold':
            return <strong key={i}>{renderInline(part.content)}</strong>
          case 'italic':
            return <em key={i}>{renderInline(part.content)}</em>
          case 'code':
            return <code key={i}>{part.content}</code>
          case 'link':
            return (
              <a key={i} href={part.url} target="_blank" rel="noreferrer">
                {renderInline(part.content)}
              </a>
            )
          default:
            return <span key={i}>{part.content}</span>
        }
      })}
    </>
  )
}

/**
 * Render a Markdown string to a list of block-level JSX elements.
 * Supported blocks: #…#### headings, `- ` / `* ` and `1. ` lists (single level),
 * `> ` blockquotes, ``` fenced code blocks, `---` horizontal rules and
 * blank-line-separated paragraphs. Unrecognized input is emitted as plain text.
 */
export function renderMarkdown(md: string): JSX.Element[] {
  const lines = md.split('\n')
  const elements: JSX.Element[] = []
  let key = 0

  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let quote: string[] = []
  let codeLines: string[] = []
  let inCode = false

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    elements.push(<p key={key++}>{renderInline(paragraph.join(' '))}</p>)
    paragraph = []
  }

  const flushList = (): void => {
    if (list === null) return
    const { ordered, items } = list
    const renderedItems = items.map((item, i) => <li key={i}>{renderInline(item)}</li>)
    elements.push(ordered ? <ol key={key++}>{renderedItems}</ol> : <ul key={key++}>{renderedItems}</ul>)
    list = null
  }

  const flushQuote = (): void => {
    if (quote.length === 0) return
    const paras: string[] = []
    let buf: string[] = []
    for (const line of quote) {
      if (line.trim() === '') {
        if (buf.length > 0) {
          paras.push(buf.join(' '))
          buf = []
        }
      } else {
        buf.push(line)
      }
    }
    if (buf.length > 0) paras.push(buf.join(' '))
    elements.push(
      <blockquote key={key++}>
        {paras.map((p, i) => (
          <p key={i}>{renderInline(p)}</p>
        ))}
      </blockquote>
    )
    quote = []
  }

  const flushCode = (): void => {
    if (codeLines.length === 0) return
    elements.push(
      <pre key={key++}>
        <code>{codeLines.join('\n')}</code>
      </pre>
    )
    codeLines = []
  }

  const flushAll = (): void => {
    flushParagraph()
    flushList()
    flushQuote()
    flushCode()
  }

  for (const rawLine of lines) {
    if (inCode) {
      // Closing fence: ``` (optionally followed by whitespace)
      if (/^```/.test(rawLine.trim())) {
        inCode = false
        flushCode()
      } else {
        codeLines.push(rawLine)
      }
      continue
    }

    const trimmed = rawLine.trim()

    // Opening fence: ```lang
    if (/^```/.test(trimmed)) {
      flushAll()
      inCode = true
      codeLines = []
      continue
    }

    if (trimmed === '') {
      flushAll()
      continue
    }

    // ATX headings: # … ####
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushAll()
      const level = heading[1].length
      const text = renderInline(heading[2])
      if (level === 1) elements.push(<h1 key={key++}>{text}</h1>)
      else if (level === 2) elements.push(<h2 key={key++}>{text}</h2>)
      else if (level === 3) elements.push(<h3 key={key++}>{text}</h3>)
      else elements.push(<h4 key={key++}>{text}</h4>)
      continue
    }

    // Blockquote: > …
    if (/^>/.test(trimmed)) {
      flushParagraph()
      flushList()
      quote.push(trimmed.replace(/^>\s?/, ''))
      continue
    }

    // Unordered list: - … or * …
    const unordered = trimmed.match(/^[-*]\s+(.+)$/)
    if (unordered) {
      flushParagraph()
      flushQuote()
      if (list === null) {
        list = { ordered: false, items: [] }
      } else if (list.ordered) {
        flushList()
        list = { ordered: false, items: [] }
      }
      list.items.push(unordered[1])
      continue
    }

    // Ordered list: 1. …
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/)
    if (ordered) {
      flushParagraph()
      flushQuote()
      if (list === null) {
        list = { ordered: true, items: [] }
      } else if (!list.ordered) {
        flushList()
        list = { ordered: true, items: [] }
      }
      list.items.push(ordered[1])
      continue
    }

    // Horizontal rule: ---
    if (/^-{3,}\s*$/.test(trimmed)) {
      flushAll()
      elements.push(<hr key={key++} />)
      continue
    }

    // Plain paragraph line
    flushList()
    flushQuote()
    paragraph.push(trimmed)
  }

  flushAll()
  return elements
}
