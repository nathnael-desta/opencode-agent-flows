export interface AgentDefinition {
  description: string
  mode: "primary" | "subagent" | "all"
  model: string
  variant?: string
  prompt?: string
}

export interface FlowDefinition {
  defaultAgent: string
  agents: Record<string, AgentDefinition>
}

export interface OpenCodeConfig {
  default_agent?: string
  agent?: Record<string, AgentDefinition | Record<string, unknown>>
}

export interface PluginOptions {
  flow?: string
  setDefault?: boolean
}
