import type { Api, RepoNavApi } from './index'

declare global {
  interface Window {
    api: Api
    repoNav: RepoNavApi
  }
}

export {}

// Re-export types for consumption by renderer
export type { Api, RepoNavApi }
