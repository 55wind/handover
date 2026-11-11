# Handover: design

Date: 2026-11-11. Deadline: 2026-11-12 12:00 PT (2026-11-13 05:00 KST), PayPal AI Hackathon on Devpost.

## 1. What it is

When someone dies, their payments keep running. The family has to find every subscription, membership and open bill, then call each merchant and send the same documents again.

Handover is an executor agent for the family. They file one notice. The agent finds what the person was paying for at participating merchants, proposes what to do with each item, and after the family approves, carries it out on PayPal: close, take over, pause, refund, waive. Each merchant's own rules bound what the agent can do, and every result is read back from PayPal before it is reported as done.

One-line pitch: **One notice settles every payment a person left behind.**

### Why this, for this hackathon

- Judging is five equal criteria: technology, design, impact, innovation, presentation. We cannot beat six-week entries on depth in about a day, so we compete on a distinct human problem, a complete narrow flow, and real PayPal sandbox calls.
- Target prizes: Most Impactful, Best Use of PayPal + AI, Most Creative. Sponsor: AG Grid (grids on two screens), Render (hosting).

## 2. Validation (done 2026-11-11)

### Overlap with other entries (GitHub search, Devpost gallery is not reachable)

- Crowded and avoided: shopping agents, spend mandates and firewalls, cooling-off holds, agent-ready storefronts (8+), agent negotiation and escrow (9+), voice shopping for blind users (5+), undo/refund agents (6+), subscription cancel tools.
- Closest entry: **NextOfKin** ("a legacy contact for your AI agents"). The living owner sets up a plan in advance with daily check-ins; on a confirmed death the agents lose permission and listed subscriptions are suspended. It has no merchant side, no refunds, no cancellations, no invoices, no transfer.
- Our difference, to state plainly in the README: Handover needs nothing set up in advance, is started by the family, works on the merchant side, and settles (closes, refunds, transfers), not only pauses.
- Positioning consequence: do not lead with "off-switch for AI agents" (NextOfKin's line). Lead with the family and the settlement.

### Prior art outside the hackathon

- UK notification services (Death Notification Service, Life Ledger, NotifyNOW) send one notice to many firms. They notify; each firm then acts by hand. None executes payment actions.
- PayPal's own process for a deceased customer: the executor sends a cover note, death certificate and proof of authority by post or email, per country.
- Guides and trackers (Elayne, Subtracker, Trustworthy) explain the steps; the family still does them.

### Evidence for the pitch (cite with source, do not round up)

- Empathy "Cost of Dying" reports: families spend about 13 months and roughly 420 hours settling affairs (figures vary by edition).
- Paid subscriptions per US adult: 3.4 (Self Financial 2026) to 4.8 (Bango 2026).
- No reliable figure exists for post-death subscription charges. Do not invent one.

### PayPal technical facts confirmed

- `@paypal/agent-toolkit` 1.11.0 exposes 46 tools, including `cancel_subscription`, `show_subscription_details`, `create_subscription`, `create_refund`, `get_refund`, `get_order`, `get_invoice`, `search_invoicing`, `cancel_sent_invoice`, `cancel_invoice_auto_reminder`, `generate_invoice_qr_code`, `create_recurring_series`, `cancel_recurring_series`, `get_recurring_series`. Its `/openai` export gives chat-completions tool schemas and `handleToolCall`. It depends on `openai` 4.86.1 and `ai` v4 (not AI SDK 7).
- Not in the toolkit, needs direct REST: list subscriptions (`GET /v1/billing/subscriptions`), suspend, activate, subscription transactions, card-funded seeding, vault tokens.
- Subscription payment transaction ids work as capture ids for `POST /v2/payments/captures/{id}/refund` (reported by another entry's spike).
- Subscriptions normally need the buyer to approve in a browser. The API also accepts `subscriber.payment_source.card`, subject to eligibility. Card-funded orders work in sandbox when the business account has Advanced Credit and Debit Card Payments.
- Sandbox Transaction Search can lag up to three hours, so it cannot be used to find fresh charges.
- Non-US sandbox accounts are reported to fail at subscription approval. Use US sandbox accounts.

**Not yet verified (no PayPal credentials at design time):** card-funded subscriptions in sandbox, recurring invoice series in sandbox, vault card tokens. Section 9 covers this.

## 3. Goals, non-goals, anti-goals

### Goals

1. One notice produces a full inventory across merchants, made of real PayPal sandbox objects.
2. The agent proposes an action per item with a plain-language reason. The family can change any row. Nothing irreversible runs before approval.
3. Execution is real: cancel or suspend subscriptions, refund captures (full or pro-rata), cancel invoices and their reminders, create a replacement subscription for a family member.
4. Safety comes from reversibility and code, not from trusting the model (section 6).
5. The agent is the actor: an LLM tool-calling loop does discovery, judgment and execution.
6. A closing statement the family can keep.
7. Judges can try it with one click, no login, with fresh sandbox data each run.

### Non-goals

- Real proof-of-death or identity verification. We do a demo-grade document check and label it as such.
- Closing the deceased's own PayPal account or moving balances.
- Merchants that are not connected (a drafted letter is a stretch item).
- Sign-in, multi-tenant accounts, live PayPal, sending email to real people.

### Anti-goals (would make it a failure even if it runs)

- Any simulated money movement presented as real. If the sandbox cannot do something, that item kind is left out, not faked.
- The agent moving money without family approval or beyond a merchant's policy.
- A mournful or exploitative tone, stock condolences, any upsell.
- Real company names or trademarks.

## 4. Users and the flow

- **Family representative**: grieving, not technical. May write in any language; the agent answers in that language.
- **Merchant**: sets a policy once, sees notices and what was done on their PayPal account.
- **Judge**: clicks "Try the demo case".

Flow on `/case/[id]`, one page, three steps:

1. **Notice.** Name, known emails, date of death, the representative's name and relation, free-text wishes, and a document (image upload or pasted text). The agent reads the document and extracts name and date. If they match what was entered, the case becomes `verified`; otherwise it stays `filed` and the page says what does not match.
2. **Plan.** The agent's activity streams live while it queries each merchant. Result: a grid of items with proposed action, refund amount, reason, and any question for the family. The family edits rows and presses Approve. While the case is only `filed`, the only button is "Pause everything for now" (reversible).
3. **Done.** Execution streams live. Each row ends as done (with PayPal ids, verified by read-back), waiting (take-over needs the family member's PayPal approval; link shown), or blocked (with the reason and next step). Then the closing statement.

`/merchant/[slug]` shows that merchant's policy and a grid of every action taken on its account.

## 5. Demo estate (fictional, seeded fresh per run)

Daniel Reyes, date of death 9 days before the run. Representative: Maria Reyes, daughter. Emails use `@example.com`.

| Merchant | Item | Kind | Expected outcome |
|---|---|---|---|
| Lumen Stream | Family plan, $17.99/month, plus a charge for a period that starts after the date of death | subscription | Take over for the family, refund the later charge |
| Ironwood Gym | Membership, $39/month | subscription | Close, refund per policy |
| Ironwood Gym | Annual locker, $120 prepaid | charge | Pro-rata refund of the unused part |
| Ironwood Gym | Invoice, $90, three training sessions not taken, reminders on | invoice | Waive: stop reminders, cancel invoice |
| Harbor Light Food Bank | Monthly gift, $25, plus one gift after the date of death | subscription | Take over in the family's name; ask before refunding the later gift |

Prefilled wishes: "Mom still watches Lumen on the family plan, please keep it for her. Dad cared about the food bank; I'd like to continue his monthly gift in my name. Close everything else."

One decoy customer (Daniela Reyes, different email) exists at Ironwood so the agent has to exclude a near match.

Merchant policies (fixed in code, different on purpose):

- Lumen Stream: refunds whole periods that start after the date of death; take-over allowed.
- Ironwood Gym: pro-rata refund of prepaid service; waives invoices for services not delivered; no take-over.
- Harbor Light Food Bank: gifts made before the date of death are not refunded; later gifts refundable on request; take-over allowed.

**Refund rule (one rule for all charges):** each charge has a service period from the merchant's records. Refundable amount = amount x share of the period that falls after the date of death, then limited by the merchant's policy, and never more than what PayPal reports as still refundable. Code computes it; the model never does arithmetic on money.

Note for the README: sandbox objects are created minutes before each demo, so PayPal timestamps are recent; service periods come from the merchant's records.

## 6. Safety rules (enforced in code, in the merchant desk)

Every write tool call passes `guard()` before it reaches PayPal. A denial returns a structured reason to the agent and appears in the activity stream.

1. **Ownership.** The target id must be in this merchant's records for the customer matched to this case.
2. **Tier.** `filed`: only suspend is allowed. `verified` and plan approved: cancel, refund, cancel invoice, create replacement subscription.
3. **Approval.** An irreversible call must match an item and action in the approved plan.
4. **Refund bounds.** Amount must not exceed the code-computed refundable amount for that capture.
5. **Once.** Each item-action runs once; `PayPal-Request-Id` is derived from case, item and action.
6. **Read-back.** After the agent reports an outcome, code re-reads the object from PayPal and sets `verified`. The UI shows "done" only when verified.

PayPal refunds return to the original payment method, so a false notice cannot extract money; the worst case is a cancelled subscription.

## 7. Architecture

One Next.js app (App Router, TypeScript, Node runtime), one process, state in memory. Hosted on Render.

```
app/page.tsx                         landing, "Try the demo case"
app/case/[id]/page.tsx               the three-step workspace
app/merchant/[slug]/page.tsx         merchant console
app/api/demo/route.ts                POST: seed a fresh estate, create the case
app/api/cases/[id]/route.ts          GET case, PATCH notice fields and row decisions
app/api/cases/[id]/run/route.ts      POST {phase: intake | plan | pause | execute}
app/api/cases/[id]/events/route.ts   GET server-sent events
app/api/merchants/[slug]/route.ts    GET policy and ledger
lib/types.ts
lib/store.ts        in-memory singleton on globalThis: cases, merchant records, ledger, event bus, daily counter
lib/merchants.ts    the three demo merchants, policies, credential slots
lib/paypal.ts       real backend: token cache, REST calls the toolkit lacks, toolkit instance per merchant
lib/paypal-fake.ts  in-memory fake backend for development and tests only
lib/guard.ts        pure functions: guard, refund math, customer matching, plan validation
lib/desk.ts         per-merchant tool list and callTool = guard + backend
lib/agent.ts        LLM loop, phases, prompts, local tools
lib/seed.ts         capability probe and demo estate seeding
scripts/probe.ts    npm run probe
scripts/e2e.ts      npm run e2e
```

### Backends

A backend is one function: `exec(toolName, args) -> JSON`. Tool names and schemas are the toolkit's own for everything it covers, plus four custom tools.

- **Real:** toolkit `handleToolCall` for toolkit tools; `fetch` for `list_subscriptions`, `suspend_subscription`, `activate_subscription`, `list_subscription_payments`, and for seeding.
- **Fake:** an in-memory state machine with the same tool names and the response fields the code reads (`status`, `id`, amounts, links). Enabled only by `PAYPAL_FAKE=1`, shows a permanent red "FAKE PAYPAL, development only" banner, and must never be set on the hosted demo.
- With neither credentials nor `PAYPAL_FAKE=1`, the app says PayPal is not configured. It does not fall back silently.

### Merchant desk

`desk(slug)` exposes `listTools()` and `callTool(name, args, caseId)`.

- Read: `find_customer_records` (code matching by email and name, returns candidates with match reasons), `get_policy`, and the PayPal read tools.
- Write: `suspend_subscription`, `activate_subscription`, `cancel_subscription`, `create_refund`, `cancel_invoice_auto_reminder`, `cancel_sent_invoice`, `create_subscription`, `generate_invoice_qr_code`.
- Every call is appended to the merchant's ledger.

The agent sees each desk's tools namespaced as `lumen__cancel_subscription`. The agent process holds no PayPal credentials.

### Agent

OpenAI-compatible chat completions with tools (`openai` SDK, same version the toolkit pins). `LLM_MODEL` (default `gpt-5.5`) and `OPENAI_BASE_URL` are configurable so another provider can be swapped in.

| Phase | Tools | Ends with |
|---|---|---|
| intake | none (vision on the document) | extracted fields and mismatches |
| plan | desk read tools, `compute_refund`, `submit_plan` | a validated plan |
| pause | desk read tools, `suspend_subscription`, `record_outcome` | all active subscriptions suspended |
| execute | desk read and write tools, `record_outcome`, `finish` | outcomes and closing statement |

- `submit_plan` is validated in code (ids exist, action allowed for kind and policy, refunds recomputed). Errors go back to the agent, up to three rounds; rows still invalid are dropped with a visible note.
- After `execute`, code checks every approved row has an outcome; missing rows are re-prompted twice, then marked "not completed".
- One run per case at a time. A hard cap on steps per phase.
- Prompt principles: reversible first, cite the merchant's policy, follow the family's wishes, never invent ids, put anything ambiguous as a question on the row, short plain sentences, no stock condolences.

### Data

```
Case   { id, tier: filed|verified, status, representative, deceased{fullName, emails[], dateOfDeath},
         wishes, document{kind, extracted, mismatches[]}, items[], approvedAt, statement, language }
Item   { id, merchant, kind: subscription|charge|invoice, label, paypalId, liveStatus, amount, cadence,
         charges[{captureId, amount, period{start,end}, refundable}],
         proposed{action, refunds[], reason, question}, decided{action, refunds[]},
         outcome{state: done|waiting|blocked|failed, refs, verified, note, link} }
Event  { ts, actor: agent|desk:<slug>|guard|family|system, type, summary, detail }
```

Actions by kind: subscription: close, take_over, pause. charge: refund, leave. invoice: waive, pay_from_estate.

Take-over: create a new subscription on the same plan for the representative (returns a PayPal approval link), suspend the old one, mark the row waiting. Finalizing the cancel of the old one after approval is a stretch item.

### UI

- English copy. Calm and typographic; not a dashboard look. Built with the `hallmark` design skill, then checked with `kill-ai-slop`.
- AG Grid Community for the plan grid (editable action cell, refund toggles, status renderer) and the merchant ledger, themed to match.
- The activity stream shows tool calls in plain words with the PayPal ids, and guard denials.
- Each PayPal id shown is copyable. A footer line states: PayPal sandbox, fictional people and merchants.

## 8. Configuration

```
OPENAI_API_KEY=            required
OPENAI_BASE_URL=           optional
LLM_MODEL=gpt-5.5
PAYPAL_1_CLIENT_ID=        sandbox REST app for merchant slot 1 (required for real mode)
PAYPAL_1_CLIENT_SECRET=
PAYPAL_2_CLIENT_ID=        optional; without it, merchants share slot 1 and the UI says so
PAYPAL_2_CLIENT_SECRET=
PAYPAL_3_CLIENT_ID=
PAYPAL_3_CLIENT_SECRET=
PAYPAL_FAKE=               1 for development and tests only
DEMO_DAILY_LIMIT=150       cap on demo runs per day, protects the LLM bill
```

`.env.local` is gitignored; `.env.example` is committed. `render.yaml` declares the service with secrets unset.

## 9. Sandbox uncertainty and how we handle it

Step one once credentials exist is `npm run probe`. It tries each primitive per merchant slot and prints what works:

| Primitive | Used for | If it fails |
|---|---|---|
| Invoice create and send | open bill | none expected |
| Card-funded order capture | charges to refund | ask the owner to enable Advanced Card Payments on the sandbox app; last resort is a small pool of buyer-approved orders |
| Card-funded subscription | recurring items | next row |
| Recurring invoice series | recurring items, second choice | next row |
| Buyer-approved subscription pool | recurring items, last choice | the owner approves a batch once; each demo run uses three |

Seeding uses the first working option for each item and records which one, so the item's kind and label stay truthful. The agent and guard work from whatever exists.

Until credentials arrive, development proceeds against the fake backend. Nothing is called finished until `npm run e2e` passes against the real sandbox.

## 10. Testing

- `node:test` through `tsx`: guard rules, refund math (period edges, policy limits, already-refunded amounts), customer matching including the decoy, plan validation.
- `npm run e2e`: seed, plan, approve, execute, then assert PayPal states. Runs against fake or real backend; the real run is the acceptance test.
- No test framework beyond that.

## 11. Deliverables beyond the app

- README: what it is, how it differs from pre-arranged legacy plans, architecture, exactly which PayPal calls are real, limits, how to run with your own sandbox keys, tools and models used.
- MIT license. Public GitHub repo.
- `docs/submission.md`: Devpost text ready to paste.
- Demo video under three minutes: screen recording of the real sandbox run with voiceover. Any AI voice or image tool used is disclosed.

## 12. Stretch, only after the core passes e2e on the real sandbox

1. Finalize take-over automatically when the new subscription becomes active.
2. An MCP endpoint per merchant desk so any MCP-capable agent can file and follow a case.
3. Revoking a stored payment token held by a shopping agent.
4. A drafted notice letter for merchants that are not connected.
5. "They can't manage things right now": a pause-only case that can be resumed.

## 13. Choices made by the builder (Claude), not by the owner

- Name "Handover"; fictional merchants and people.
- Next.js, in-memory state, no database.
- OpenAI key found on the development machine is used for the LLM; provider is swappable.
- Toolkit `/openai` export with a manual tool loop instead of an agent framework.
- MCP is a stretch item, not the core path.
- English UI and docs.

## 14. Needed from the owner

1. PayPal developer account; **US** sandbox business account(s) and one REST app per merchant slot (one is enough to start); client id and secret into `.env.local`.
2. A Render account (or permission to deploy another way) and the same secrets there.
3. Upload the video to YouTube, confirm the public repo, press Submit on Devpost.
