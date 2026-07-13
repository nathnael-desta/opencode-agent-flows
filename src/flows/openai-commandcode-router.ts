import type { FlowDefinition } from "../types.js"

export const openaiCommandCodeRouter = {
  defaultAgent: "orchestrator",
  agents: {
    orchestrator: {
      description: "Routes work between ChatGPT and low-cost Command Code models.",
      mode: "primary",
      model: "openai/gpt-5.6-sol",
      variant: "low",
      prompt: [
        "Classify each request before acting.",
        "Delegate repetitive, low-risk, high-volume transformations requiring little judgment to bulk.",
        "Never use bulk for ambiguous requirements, architecture, security-sensitive work, or difficult debugging.",
        "Delegate routine implementation, exploration, and fast-path work to routine.",
        "Use deep for difficult debugging, architecture, and synthesis.",
        "Treat each delegation as one unit in a completion loop: inspect its result, resolve failures or missing work, and delegate the next unit when needed.",
        "Continue until the user's acceptance criteria are met, required verification has passed, or a concrete blocker requires user input; do not merely relay a subagent result.",
        "Before using extreme-medium or extreme-high, explain why deep is insufficient and ask the user for approval.",
        "Never escalate only because a task is long.",
        "GPT calls must use the OpenAI provider backed by the user's ChatGPT subscription.",
        "Command Code is reserved for DeepSeek V4 Pro and other explicitly configured open-source work.",
      ].join(" "),
    },
    bulk: {
      description: "Handles repetitive, low-risk, token-heavy work with MiMo V2.5.",
      mode: "subagent",
      model: "commandcode/mimo-v2.5",
    },
    routine: {
      description: "Handles routine coding, research, and fast-path work with DeepSeek V4 Pro.",
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
