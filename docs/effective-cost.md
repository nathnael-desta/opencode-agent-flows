# Effective cost

The single idea that makes model selection here different: **a model's paper
price is usually not what you pay at the margin.**

If you rank models by list price, you will pick the wrong ones. A model you have
already paid for — through a subscription or a bundled credit grant — costs you
approximately nothing extra to call, no matter what its published rate says.

## Billing sources

Every model is tagged with how it reaches you:

| Billing source | Effective marginal cost | Typical example |
|---|---|---|
| `metered` | Paper price per token | A raw API key |
| `subscription-flat` | **~$0** within plan capacity | ChatGPT Plus/Pro, Claude Max |
| `credit-pool` | Paper price, drawn from a fixed monthly balance | A $40/month credit allowance |
| `bundled-credit` | **~$0** until the bundle is exhausted | Gemini via Google AI Pro / Antigravity credits |
| `unknown` | Assumed paper price | Not yet classified |

## A worked example

Say discovery finds two models:

| Model | Paper blended price | Quality (AA coding index) |
|---|---|---|
| `openai/gpt-5.6-sol` | $11.25 / 1M tokens | 77.4 |
| `commandcode/deepseek-v4-pro` | $0.75 / 1M tokens | 59.4 |

Ranked on paper price, DeepSeek obviously wins the cost-sensitive `bulk` role.

Now you tell the interview that your OpenAI access is `subscription-flat`,
because it runs on a ChatGPT plan you already pay for. Its effective marginal
cost drops to ~$0 — and the *stronger* model now wins even the cost-led role,
because it is both better **and** effectively free.

That inversion is the whole point. This is exactly the case the project tests:

> Treating a paper-expensive model as `subscription-flat` makes it free at the
> margin, so it wins even the cost-led role.

## Capacity is the catch

`subscription-flat` and `bundled-credit` are ~$0 **within capacity**. They are
not unlimited:

- Subscription plans have rate and usage limits that are not token-metered.
- Bundled credits run out.

So the interview also asks what pricing data cannot show — which plans you are
close to exhausting, which limits you keep hitting, and whether you want to hold
a premium plan in reserve for escalation rather than spending it on bulk work.
Record that reasoning in `effectiveCostNote`; it shows up in `/flow-config` and
the dashboard so future-you remembers why a choice was made.

> [!WARNING]
> Because subscription and bundle capacity is not token-metered, reported
> savings are an **estimate**. Telemetry marks subscription-backed calls as `$0`
> metered and never presents them as a billed API charge.

## How ranking works

Each role is ranked with one of three weightings:

| Weighting | Roles | Behavior |
|---|---|---|
| `quality-led` | `orchestrator`, `deep`, `extreme-*` | Quality dominates; cheapness breaks ties |
| `balanced` | `routine`, `reviewer` | Both matter |
| `cost-led` | `bulk` | Cheapness dominates; quality is a small factor |

Prices are blended from input and output at a 3:1 ratio, matching how
Artificial Analysis reports a single blended price, so one number can order the
list.

The formula is deliberately simple and transparent so the setup interview can
explain any ranking to you in one line. It is a starting point for a decision,
not an oracle — you confirm every role before anything is saved.

## Where quality comes from

Artificial Analysis's coding index, fetched keyless as JSON through OpenRouter's
public models endpoint — no API key, no signup. Scores carry the index they came
from, and are never mixed across indices.

See [Tools and commands](tools.md#flow_discover_models) for the full source
list, the exact-matching rules, and how everything degrades offline.
