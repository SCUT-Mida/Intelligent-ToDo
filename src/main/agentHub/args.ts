/**
 * Shell-style argument tokenizer for Agent Hub.
 *
 * Splits a user-supplied args string (e.g. `--model opus --foo "bar baz"`)
 * into an argv-style array that can be appended to a PTY spawn call.
 *
 * Supported syntax (POSIX-ish subset, sufficient for CLI agent flags):
 *   - Whitespace separates tokens
 *   - Double quotes `"..."` preserve inner whitespace (backslash is LITERAL
 *     inside double quotes — Windows path-friendly, e.g. `"C:\dir\file"`)
 *   - Single quotes `'...'` preserve inner whitespace (no escaping)
 *   - Backslash `\` escapes the next char ONLY when unquoted
 *     (so `path\ with\ spaces` works for filenames with spaces)
 *
 * NOT supported (intentionally — out of scope for CLI agent flags):
 *   - Command substitution $(), backticks
 *   - Globs *, ?, [abc]
 *   - Variable expansion $VAR (left as literal text)
 *   - Semicolon command chaining, pipes, redirects
 *
 * This is deliberately minimal and dependency-free. For the rare case where
 * users need full shell semantics, they can wrap their command in a shell.
 */

/**
 * Tokenize an args string into an argv array.
 *
 * Returns an empty array for empty/whitespace input. Never throws — malformed
 * quoting falls back to treating the quote char as literal.
 *
 * @example
 *   tokenizeArgs('--model opus')              // ['--model', 'opus']
 *   tokenizeArgs('--msg "hello world"')       // ['--msg', 'hello world']
 *   tokenizeArgs("--name 'a b'")              // ['--name', 'a b']
 *   tokenizeArgs('path\\ with\\ spaces')      // ['path with spaces']
 *   tokenizeArgs('')                          // []
 *   tokenizeArgs('   ')                       // []
 */
export function tokenizeArgs(input: string): string[] {
  const s = input ?? ''
  const out: string[] = []
  let current = ''
  let hasToken = false
  let i = 0

  while (i < s.length) {
    const ch = s[i]

    // Whitespace → token boundary (only if we're not inside a quote)
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (hasToken) {
        out.push(current)
        current = ''
        hasToken = false
      }
      i++
      continue
    }

    // Unquoted backslash escape → take next char literally
    if (ch === '\\') {
      const next = s[i + 1]
      if (next !== undefined) {
        current += next
        hasToken = true
        i += 2
        continue
      }
      // Trailing backslash with no following char → literal backslash
      current += '\\'
      hasToken = true
      i++
      continue
    }

    // Double-quoted segment: backslash is LITERAL inside (Windows path-friendly).
    // Only `"` ends the quoted section; everything else is taken verbatim.
    if (ch === '"') {
      hasToken = true
      i++
      while (i < s.length && s[i] !== '"') {
        current += s[i]
        i++
      }
      // Skip the closing quote (if present; if absent, we just end)
      if (i < s.length && s[i] === '"') i++
      continue
    }

    // Single-quoted segment: NO escaping inside, whitespace preserved
    if (ch === "'") {
      hasToken = true
      i++
      while (i < s.length && s[i] !== "'") {
        current += s[i]
        i++
      }
      if (i < s.length && s[i] === "'") i++
      continue
    }

    // Regular char
    current += ch
    hasToken = true
    i++
  }

  // Flush trailing token
  if (hasToken) {
    out.push(current)
  }

  return out
}
