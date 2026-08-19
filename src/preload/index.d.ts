import type { Api, RepoNavApi, AgentHubApi, ApiToolApi } from './index'

declare global {
  interface Window {
    api: Api
    repoNav: RepoNavApi
    agentHub: AgentHubApi
    apiTool: ApiToolApi
  }
}

export {}

// Re-export types for consumption by renderer
export type { Api, RepoNavApi, AgentHubApi, ApiToolApi }
