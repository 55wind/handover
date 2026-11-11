# Devpost submission text

Paste each block into the matching field. Items marked TODO are filled in after the real sandbox run and deployment.

## Project name

Handover

## Elevator pitch (tagline)

One notice settles every payment a person left behind. An executor agent that closes, refunds and hands over a late relative's PayPal payments, within each merchant's rules.

## About the project

### Inspiration

When someone dies, their payments don't. The streaming plan renews, the gym bills another month, an invoice keeps sending reminders. The family has to find each one, call each merchant, and send the same death certificate again and again, during the worst weeks of their lives. Surveys by Empathy put the work of settling a relative's affairs at around 13 months and hundreds of hours.

Most payment tools are built for the start of a customer relationship. We wanted to build for the end of one, and to make it one conversation.

### What it does

A family member files one notice: who died, when, which email addresses they used, and what the family wants, in their own words. They attach a document such as a funeral notice.

Handover's agent then:

1. Reads the document and checks that the name and date match the notice.
2. Asks each participating merchant's desk what it holds for that person, checks every item's live state on PayPal, and reads the merchant's bereavement policy.
3. Proposes one action per item with a plain reason: close, take over, pause, refund, waive. In the demo it closes a gym membership and refunds the unused days, returns the unused part of a prepaid annual fee, cancels an invoice for sessions never taken, and hands a family streaming plan and a monthly charity gift over to the daughter instead of ending them. It also notices a customer with a similar name at one merchant and leaves that account alone.
4. After the family approves, carries the plan out on PayPal and reads every result back before calling it done.
5. Produces a closing statement with PayPal's reference for each step.

Until the document matches, the only thing the agent can do is pause subscriptions, and the family can undo that with one click.

### How we built it

- **PayPal Agent Toolkit** (`@paypal/agent-toolkit`) gives the model PayPal's own tool schemas: `show_subscription_details`, `cancel_subscription`, `create_subscription`, `create_refund`, `get_refund`, `get_order`, `get_invoice`, `cancel_invoice_auto_reminder`, `cancel_sent_invoice`, `generate_invoice_qr_code`. Suspend and activate subscription go to the Subscriptions REST API directly.
- **The agent** is a tool-calling loop over an OpenAI-compatible endpoint, with five phases: intake, plan, pause, resume, execute. It holds no PayPal credentials.
- **Merchant desks** sit between the agent and PayPal, one per merchant. A desk lists the tools the current phase allows, checks every call against a guard written in plain code, calls PayPal with that merchant's credentials, and writes the call to the merchant's ledger.
- **The guard** decides what the model must not: which account belongs to the person (exact email match only), whether a step is allowed before the document is matched, whether it matches what the family approved, and how much a refund is. Refund amounts are computed from the charge's service period, the date of death and the merchant's policy, and the desk overwrites any amount the model sends.
- **AG Grid** shows the plan the family edits and each merchant's ledger of actions. The agent's activity streams live to the page.
- Everything on screen is a real PayPal sandbox object: subscriptions, card captures, refunds, invoices. Each demo run seeds a fresh estate across three merchants.

### Challenges we ran into

- Sandbox subscriptions normally need a buyer to approve each one in a browser, and their first payment arrives asynchronously, which makes a self-serve demo with refunds hard. We seed card-funded objects and take each period charge as its own capture so every run starts fresh.
- Deciding what the model may decide. Our first sketch let the model judge which customer records belonged to the person. That moved into code, along with every amount: the model proposes and explains, code sets ownership and money.
- Tone. The subject is death and money. We removed every stock condolence and anything that read like a sales flow.

### Accomplishments that we're proud of

- A complete path from one notice to a closing statement, with real refunds, cancellations and a hand-over on the sandbox.
- "Done" means PayPal confirmed it. The page never shows a step as complete on the model's word.
- Handing things over, not only shutting them down: the streaming plan a widow still watches stays on, in her daughter's name.

### What we learned

- Safety for payment agents comes from reversibility and from narrow tools more than from prompts. Pause first, and let code hold the pen on money.
- Merchant policy is the natural place to bound an agent. Each desk enforces its own rules, so a new merchant does not change the agent.

### What's next

- Real proof-of-death checks through registries or certified documents. This build's document check is demo-grade.
- A desk any merchant can install, exposed over MCP so any assistant can file a notice.
- Revoking spending mandates that shopping agents hold for the person.
- A case type for someone who is alive but cannot manage things for now: pause and resume only.

## Built with

PayPal Agent Toolkit, PayPal Orders API, PayPal Subscriptions API, PayPal Invoicing API, PayPal Payments (refunds) API, PayPal sandbox, Next.js, React, TypeScript, AG Grid, Render, OpenAI-compatible LLM API (TODO: model name)

## AI tools used and how

- TODO model name, through an OpenAI-compatible chat completions endpoint: reads the document, plans and executes through tool calls.
- Claude Code (Anthropic): wrote most of the code, tests and documents under the author's direction.
- TODO if used: text-to-speech for the video voiceover.

## PayPal products used and how

- Subscriptions: read, suspend, activate, cancel, and create a replacement subscription for the family member.
- Orders and Payments: card captures for each period charge; full and partial refunds.
- Invoicing: read the open invoice, stop its reminders, cancel it, or produce a payment QR code when the family prefers to pay from the estate.
- Agent Toolkit: the model calls PayPal's own tool definitions through each merchant's desk.

## Links

- Repository: TODO
- Live demo: TODO
- Video: TODO

## Testing instructions for judges

1. Open the live demo and press "Try the demo case". A fresh sandbox estate is created at three fictional merchants; this takes a few seconds.
2. Press "File this notice". Watch the agent read the document and build the plan.
3. Change any row if you like, then press "Approve and carry out".
4. Open a merchant console from the home page to see the same actions from the merchant's side.
5. To approve a take-over as the family member, use the sandbox buyer login: TODO email / TODO password.

No login is needed for the app itself. The demo is limited to 40 runs a day. Cases live in memory and disappear if the server restarts; start a new one.
