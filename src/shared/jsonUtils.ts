/**
 * Tolerant JSON extraction from LLM responses.
 *
 * LLMs frequently wrap JSON in markdown code fences or surround it with
 * prose despite "strict JSON" instructions. These helpers strip the noise
 * and parse the first well-formed JSON value.
 *
 * Extracted here (shared) so main/index.ts (todo priorities) and
 * main/repoNav/aiMemory.ts (repo memory) use ONE implementation.
 */

/**
 * Extract a JSON object from an LLM response that may be wrapped in markdown
 * code fences or surrounded by prose. Returns the parsed value or null.
 */
export function extractJson(content: string): unknown | null {
  if (!content) return null
  // Strip markdown code fences ```json ... ``` or ``` ... ```
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1] : content
  // Find the first '{' and matching last '}'
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const slice = candidate.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch {
    return null
  }
}

/**
 * Extract a JSON array from an LLM response that may be wrapped in markdown
 * code fences or surrounded by prose. Returns the parsed array or null.
 */
export function extractJsonArray(content: string): unknown[] | null {
  if (!content) return null
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1] : content
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  const slice = candidate.slice(start, end + 1)
  try {
    const parsed = JSON.parse(slice)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
