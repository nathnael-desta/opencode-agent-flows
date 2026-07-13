import { flows } from "./src/flows/index.js"
import type { OpenCodeConfig, PluginOptions } from "./src/types.js"

export default async function agentFlowsPlugin(
  _input: unknown,
  options: PluginOptions = {},
) {
  const flowName = options.flow ?? "best-of-both-worlds"
  const flow = flows[flowName]
  if (!flow) {
    throw new Error(`Unknown OpenCode agent flow: ${flowName}`)
  }

  return {
    config: async (config: OpenCodeConfig) => {
      config.agent ??= {}
      for (const [name, definition] of Object.entries(flow.agents)) {
        config.agent[name] ??= definition
      }

      if (options.setDefault !== false) {
        config.default_agent ??= flow.defaultAgent
      }
    },
  }
}
