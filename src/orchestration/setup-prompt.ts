/**
 * Instruction templates registered as OpenCode commands by the plugin's config
 * hook, so the setup experience ships with the plugin instead of requiring a
 * hand-installed skill file.
 */

export const SETUP_COMMAND_TEMPLATE = [
  "You are running the orchestration setup interview. Configure which model backs each orchestration role, based on what the user actually has available and what it actually costs them.",
  "",
  "Work through these steps in order. Ask questions in small batches and wait for answers; never guess on the user's behalf.",
  "",
  "1. Call flow_discover_models with no arguments. It lists the provider models OpenCode can reach, with models.dev pricing, Artificial Analysis quality, and a per-role ranking. Summarize briefly what is available; do not dump the whole list.",
  "",
  "2. Establish EFFECTIVE cost, which is the point of this interview. A model's paper price is often not what the user pays at the margin. Ask the user, for each provider that appeared in discovery, which of these applies:",
  "   - subscription-flat: covered by a flat subscription, so extra calls are ~free until plan capacity runs out (for example a ChatGPT Plus/Pro or Claude Max plan used through this provider).",
  "   - bundled-credit: paid for as part of another purchase, so it is effectively free until the bundle is exhausted (for example Gemini models via Google AI Pro or Antigravity credits).",
  "   - credit-pool: drawn at paper price against a fixed monthly credit balance.",
  "   - metered: billed per token at paper price on a normal API key.",
  "   Also ask what the user needs you to know that pricing data cannot show: capacity or rate limits they keep hitting, providers or model families they want to avoid or prefer, whether a specific plan is close to exhausted, and how much they care about keeping a premium plan in reserve.",
  "",
  "3. Re-rank with that knowledge. A paper-expensive model backed by a subscription or a prepaid bundle can be the correct cheap default; say so explicitly when it happens, because that is usually the most valuable result of this interview.",
  "",
  "4. Propose one model per role, each with a one-line rationale naming its quality index and effective cost:",
  "   - orchestrator: routes and delegates. Favor strong reasoning at low effective cost; it runs on every turn.",
  "   - bulk: repetitive, low-risk, token-heavy work. Favor the cheapest capable model.",
  "   - routine: the default worker for bounded implementation and exploration. Favor balance.",
  "   - reviewer: independent milestone review. Prefer a DIFFERENT model family from routine, and say so if no independent family is available.",
  "   - deep: evidence-backed escalation after routine fails or blocks. Favor the strongest model.",
  "   - extreme-medium and extreme-high: exceptional approval-gated tiers; usually the same strong model at higher reasoning effort.",
  "   Omitted roles fall back automatically (bulk and reviewer to routine; deep and extreme-* to orchestrator), so only set what the user wants to differ.",
  "",
  "5. Show the full proposal and ask the user to confirm or change any role. Do not persist anything until they confirm.",
  "",
  "6. Persist with flow_configure, passing a roles JSON object mapping each role to its model, optional variant, billingSource, and a short effectiveCostNote explaining why it is cheap or expensive for this user.",
  "",
  "7. Call flow_antigravity. Then tell the user that the orchestration operating-policy skills are installed separately from npm, and that the orchestrator only loads them on demand so they cost nothing until used:\n   npx skills@latest add nathnael-desta/skills --skill browser-control-operations --skill antigravity-delegation --agent opencode --global -y\n   browser-control-operations covers driving a browser economically through Browser Control MCP; antigravity-delegation covers offloading vision and large-context reads to Gemini. If Antigravity (Google AI Pro / agy CLI) is available, say that installing the opencode-antigravity-delegate plugin exposes the antigravity_vision, antigravity_delegate, and antigravity_background tools the orchestrator will then use automatically. Do not change their role bindings for this; it is a complementary helper, not a role model.",
  "8. Finish by telling the user to set { \"flow\": \"custom\" } in their opencode.json plugin options and restart OpenCode, and that flow_config shows the saved configuration at any time.",
].join("\n")

export const CONFIG_COMMAND_TEMPLATE = [
  "Call flow_config and show the user their current orchestration configuration exactly as returned.",
  "Then offer, without doing it yet, that they can change one role with flow_configure, or re-run the full interview with the flow-setup command.",
].join("\n")
