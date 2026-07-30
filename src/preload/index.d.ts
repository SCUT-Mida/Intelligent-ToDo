import type { Api, RepoNavApi, AgentHubApi } from './index'

declare global {
  interface Window {
    api: Api
    repoNav: RepoNavApi
    agentHub: AgentHubApi
  }
}

export {}

// Re-export types for consumption by renderer
export type { Api, RepoNavApi, AgentHubApi }
