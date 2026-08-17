import { defineConfig } from 'vitest/config'

/**
 * Unit tests for pure logic modules (v1.22).
 *
 * Philosophy (borrowed from deepseek-harness's testing docs): verify real
 * code paths and only mock the LLM/network boundary — which these tests
 * never touch, because they target pure functions only. Modules that
 * import 'electron' are NOT imported here; test those through the app.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
