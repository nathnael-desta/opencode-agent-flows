import { openaiCommandCodeRouter } from "./openai-commandcode-router.js"
import type { FlowDefinition } from "../types.js"

export const flows: Record<string, FlowDefinition> = {
  "openai-commandcode-router": openaiCommandCodeRouter,
}
