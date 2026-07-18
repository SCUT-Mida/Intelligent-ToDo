/**
 * AI configuration discovery — scan external tool configs (opencode) and
 * surface provider/model lists so users can import instead of re-typing.
 *
 * Scope: opencode.json only (per v1.11.0 design decision). Claude config
 * support deferred — Anthropic protocol isn't directly compatible with the
 * OpenAI-compatible protocol this app uses.
 */

// ── IPC channel ─────────────────────────────────────────────────────────────

export const AI_IPC = {
  SCAN_CONFIGS: 'aiConfig:scan'
} as const

// ── Provider / model types ──────────────────────────────────────────────────

/** A single model entry inside a provider. */
export interface AiProviderModel {
  /** Model ID as expected by the API (e.g. 'glm-5.2', 'gpt-4o-mini'). */
  modelId: string
  /** Optional display name (falls back to modelId in UI). */
  displayName?: string
}

/** A discovered provider with its auth + optional model list. */
export interface AiProviderConfig {
  /** Which file this came from. */
  source: 'opencode'
  /** Provider ID from opencode.json (e.g. 'zhipuai-coding-plan', 'x-openai'). */
  providerId: string
  /** Human-friendly name for display (Chinese where known). */
  displayName: string
  /** API key extracted from options.apiKey. */
  apiKey: string
  /**
   * Base URL for OpenAI-compatible requests.
   * - For custom providers: copied from options.baseURL
   * - For known built-in providers: resolved from KNOWN_OPENCODE_PROVIDERS
   * - If both fail: undefined (UI will ask user to fill manually)
   */
  baseURL?: string
  /** True if baseURL came from the lookup table (not from user's file). */
  baseURLInferred: boolean
  /** Models discovered for this provider (may be empty). */
  models: AiProviderModel[]
}

/** Result of scanning all known AI tool config files. */
export interface AiConfigScanResult {
  providers: AiProviderConfig[]
  /** Non-fatal errors (file not found, parse error). Empty on full success. */
  errors: string[]
  /** Paths that were attempted (for the UI to display). */
  scannedPaths: string[]
}

// ── Known provider URL mapping ──────────────────────────────────────────────

/**
 * Built-in opencode providers and their OpenAI-compatible base URLs.
 *
 * opencode.json stores only `apiKey` for these providers (the baseURL is
 * baked into the opencode binary). To import them into this app we need
 * to resolve the URL ourselves.
 *
 * Extend this table as users request more providers.
 */
export const KNOWN_OPENCODE_PROVIDERS: Record<string, { url: string; name: string }> = {
  // Chinese providers
  zhipuai: { url: 'https://open.bigmodel.cn/api/paas/v4', name: '智谱 BigModel' },
  'zhipuai-coding-plan': { url: 'https://open.bigmodel.cn/api/paas/v4', name: '智谱 BigModel (Coding Plan)' },
  deepseek: { url: 'https://api.deepseek.com/v1', name: 'DeepSeek' },
  qwen: { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', name: '通义千问' },
  doubao: { url: 'https://ark.cn-beijing.volces.com/api/v3', name: '火山方舟豆包' },
  moonshot: { url: 'https://api.moonshot.cn/v1', name: 'Moonshot Kimi' },
  baichuan: { url: 'https://api.baichuan-ai.com/v1', name: '百川' },
  minimax: { url: 'https://api.minimax.chat/v1', name: 'MiniMax' },
  yi: { url: 'https://api.lingyiwanwu.com/v1', name: '零一万物' },
  stepfun: { url: 'https://api.stepfun.com/v1', name: '阶跃星辰 Step' },
  '01ai': { url: 'https://api.lingyiwanwu.com/v1', name: '零一万物' },
  // International providers
  openai: { url: 'https://api.openai.com/v1', name: 'OpenAI' },
  anthropic: { url: 'https://api.anthropic.com/v1', name: 'Anthropic' },
  openrouter: { url: 'https://openrouter.ai/api/v1', name: 'OpenRouter' },
  groq: { url: 'https://api.groq.com/openai/v1', name: 'Groq' },
  mistral: { url: 'https://api.mistral.ai/v1', name: 'Mistral' },
  perplexity: { url: 'https://api.perplexity.ai', name: 'Perplexity' },
  together: { url: 'https://api.together.xyz/v1', name: 'Together AI' },
  fireworks: { url: 'https://api.fireworks.ai/inference/v1', name: 'Fireworks' },
  siliconflow: { url: 'https://api.siliconflow.cn/v1', name: 'SiliconFlow' },
  grok: { url: 'https://api.x.ai/v1', name: 'xAI Grok' },
  xai: { url: 'https://api.x.ai/v1', name: 'xAI' }
}
