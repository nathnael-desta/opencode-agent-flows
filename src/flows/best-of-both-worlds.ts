import type { FlowDefinition } from "../types.js"

export const bestOfBothWorlds = {
  defaultAgent: "orchestrator",
  agents: {
    orchestrator: {
      description: "Routes work between ChatGPT and permanently discounted Command Code models.",
      mode: "primary",
      model: "openai/gpt-5.6-sol",
      variant: "low",
      prompt: [
        "Classify each request before acting.",
        "Delegate routine implementation, exploration, and fast-path work to routine.",
        "Use deep for difficult debugging, architecture, and synthesis.",
        "Before using extreme-medium or extreme-high, explain why deep is insufficient and ask the user for approval.",
        "Never escalate only because a task is long.",
        "GPT calls must use the OpenAI provider backed by the user's ChatGPT subscription.",
        "Command Code is reserved for DeepSeek V4 Pro and other explicitly configured discounted open-source work.",
      ].join(" "),
    },
    routine: {
      description: "Handles routine coding, research, and fast-path work with the permanent DeepSeek discount.",
      mode: "subagent",
      model: "commandcode/deepseek-v4-pro",
      variant: "high",
    },
    deep: {
      description: "Handles difficult debugging, architecture, and synthesis through ChatGPT.",
      mode: "subagent",
      model: "openai/gpt-5.6-sol",
      variant: "low",
    },
    "extreme-medium": {
      description: "Exceptional ChatGPT escalation tier; requires user approval.",
      mode: "subagent",
      model: "openai/gpt-5.6-sol",
      variant: "medium",
    },
    "extreme-high": {
      description: "Highest ChatGPT escalation tier; requires explicit user approval.",
      mode: "subagent",
      model: "openai/gpt-5.6-sol",
      variant: "high",
    },
  },
} satisfies FlowDefinition
