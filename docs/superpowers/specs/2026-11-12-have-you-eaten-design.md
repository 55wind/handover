# Have You Eaten?: design

Date: 2026-11-12. Replaces Fair Hour (a near-identical entry exists). Deadline: 2026-11-12 12:00 PT (2026-11-13 05:00 KST).

## 1. What it is

In many languages "have you eaten?" is how people say they care. When the person you care about lives in another city or country, you cannot put a bowl of soup in front of them.

Have You Eaten? lets you say it in one sentence: "My mom in Busan has a cold, get her something warm tonight." An agent finds a neighbourhood shop near her, picks a dish that fits, and writes your card in her language. PayPal holds the money and takes none of it. She shows a code at the counter, the agent takes exactly the price of what she ate, and the rest of the hold is released. If she never goes, nothing is taken at all.

One-line pitch: **Tell an agent who you miss. It buys them a meal at the shop next door, and you pay only when they eat.**

### Who does what

| Part | Who | What |
|---|---|---|
| The errand | Errand agent (LLM with tools) | Understands the sentence, looks up shops and menus near the recipient, picks one dish with a reason, writes the card in the recipient's language. |
| The host | Host agent (LLM with tools) | Talks to the recipient in their language: shows the treat, changes it within what is held ("I can't eat seafood"), notes when they will go, takes a thank-you or a polite no and passes it on, translated. Never mentions a price. |
| The till | Till agent (LLM with tools) | At the counter: reads the PayPal order, takes the price, releases the rest, pays the shop, tells the shop and the sender what happened. |
| Money and limits | Code | Every amount, the conversion, the ceiling, one use per code, the right shop, the three-day limit. After each settlement code reads PayPal back; the page says "paid" only from that reading. |
| The money | PayPal | A hold on the sender (order with intent AUTHORIZE), a capture of part of it at the counter, a void if unused, a payout to the shop. |
| Other people's assistants | MCP | `find_treats`, `send_treat`, `treat_status`: a personal AI assistant can send a treat for its user. |

### Why not a gift card or a coupon

A gift card takes the money at once, works at one chain, and is lost if it is not used. Here the money is only held, any shop with a PayPal account can take part, across borders, and an unused treat costs nothing. The sender does not need to know the shops, the language or the menu: the agent does.

### Neighbours in this hackathon (README survey of 3,704 entries, 2026-11-12)

No entry sends a treat to someone far away at a local shop. Nearest: `common-grounds` (two people who meet at a café; one treats the other with a hold captured at pick-up) and `pi-family-care` (ordering medicine for parents abroad). Holds captured after a check are common as a mechanism.

## 2. Goals, non-goals, anti-goals

Goals: one sentence in, a redeemable treat out; a recipient who can change or decline it without seeing a price; a counter that takes exactly what was eaten; nothing taken for an unused treat; the same desk for AI assistants; judges can try all three roles.

Non-goals: delivery, tips, tax, real shop onboarding, live exchange rates (a dated table), shop sign-in.

Anti-goals: taking more than the price of what was eaten; a model deciding an amount; showing the recipient a price; presenting simulated payments as real.

## 3. Rules enforced in code (`lib/rules.ts`)

1. An item's price in USD is its menu price divided by the dated rate, rounded up to a cent.
2. The hold is the sender's budget if they gave one (never below the item, never above $40), otherwise the item plus a quarter rounded up to a dollar.
3. The recipient may change the treat only while the money is held, only to a shop in the same city, only within the hold.
4. The counter may take payment only for the shop the treat is for, once, within three days, and only the price of the chosen item.
5. A treat that is declined, cancelled or not used in three days is released: the hold is voided.
6. The till agent's closing words are shown only if they agree with PayPal's record. If the model fails, the same rules settle without it.

## 4. Pages and API

Pages: `/` landing, `/send` (the sender talks to the agent, then PayPal), `/treat/[id]` (the sender's page: link to share, activity, result), `/t/[code]` (the recipient: card, treat, code for the counter, conversation), `/shop/[id]` (the counter: enter a code), `/ledger` (every treat, with PayPal's ids).

API (JSON; errors are `{ error: string }` with a 4xx status):

| Call | Body | Answer |
|---|---|---|
| `POST /api/treats` | `{ name?, language? }` | 201 `Treat` (status `draft`) |
| `GET /api/treats/[id]` | | `Treat` |
| `POST /api/treats/[id]/errand` | `{ text }` | `Treat` after the agent replied (it may now carry `to`, `shopId`, `itemId`, `card`, `reason`, `price`, `ceiling`) |
| `POST /api/treats/[id]/checkout` | | `{ approveUrl }`: send the browser there |
| `GET /api/treats/[id]/return` | | 302 to `/treat/[id]`; the server asks PayPal, places the hold, status becomes `held` |
| `POST /api/treats/[id]/cancel` | | `Treat` (released) |
| `GET /api/treats/[id]/events` | | SSE: `{ treat }`, then `{ event, treat }` |
| `GET /api/t/[code]` | | `RecipientView` |
| `POST /api/t/[code]/host` | `{ text }` | `RecipientView` after the agent replied |
| `GET /api/t/[code]/events` | | SSE: `{ view }` on every change |
| `GET /api/shops` | | `{ shops: ShopCard[], fx: { date, source }, fake, scripted }` where a `ShopCard` is a `Shop` whose menu items also carry `usd` and `local` |
| `GET /api/shops/[id]` | | `{ shop: ShopCard, served: LedgerRow[] }` |
| `POST /api/shops/[id]/redeem` | `{ code }` | `{ served: { toName, item, localName, charged, forShop, verified } }` or `{ error }`; returns when settlement is finished |
| `GET /api/ledger` | | `{ rows: LedgerRow[], totals: { treats, enjoyed, held, charged, released }, fake, scripted }` |
| `POST /api/mcp` | JSON-RPC | MCP tools |

Types are in `lib/types.ts`.

## 5. Not yet verified (no credentials at design time)

- Capturing part of an authorization and seeing the rest released, on the real sandbox.
- Payouts from the platform's sandbox account to a shop's sandbox account.

## 6. Needed from the owner

A funded LLM key (no image input needed). A PayPal sandbox app (US business account) and two sandbox personal accounts: one to pay as the sender, one to stand for the shops' PayPal account (`SHOP_PAYOUT_EMAIL`). Render, YouTube, Devpost.
