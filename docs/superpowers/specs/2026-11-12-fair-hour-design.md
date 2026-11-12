# Fair Hour: design

Date: 2026-11-12. Replaces the Handover design. Deadline: 2026-11-12 12:00 PT (2026-11-13 05:00 KST).

## 1. What it is

A price tag says the same number everywhere, but it does not cost the same. A $44 course is one hour of average income in the United States and almost eighteen hours in Viet Nam.

Fair Hour lets a small seller of digital goods price in hours of life instead of dollars. A buyer anywhere is quoted the amount that costs them a comparable share of an hour of local income, inside limits the seller sets. The buyer's PayPal wallet proves where they live: the buyer approves an order that only asks for a hold, the agent reads the payer's country from PayPal, and it holds and captures the payment if the country matches the quote or releases it if it does not. On a mismatch no hold is even placed. Nothing is taken from a buyer who is quoted the wrong price.

One-line pitch: **Priced in hours, not dollars. A clerk who listens. Proven by the wallet, not the IP address.**

### Who does what

A neighbourhood shopkeeper knows who is a student and who has had a hard month, and takes a little off. Online checkout has no such discretion. Fair Hour gives that discretion to an AI clerk, and gives the parts that must not be fooled to PayPal and to code.

| Part | Who | What |
|---|---|---|
| Listening and judging | The clerk (LLM) | Opens the conversation in the buyer's language, explains the price in hours, hears a situation, reads a document in any country's format, decides whether and how much to help, records a gift. It does not bargain. |
| Proof of residence | PayPal | Reports the country the paying wallet is registered in. |
| Limits | Code | Every amount, the country match, the help caps, the pool balance. Help comes only from a pool: the seller opens it with $20, and after that buyers fill it with gifts. |
| Settlement | The settlement agent (LLM with tools) | Reads the order, holds, takes or releases the payment, and tells the buyer what happened in their language. Code refuses any step the rules do not allow and releases whatever is left open. |

### Why this, for this hackathon

- A survey of 3,415 hackathon repositories on GitHub (README text, 2026-11-12) found no entry that prices by the buyer's country or purchasing power. "Payer country" appears only in fraud checks.
- It is about every country by construction, so it does not depend on one culture's habits.
- It answers a question agentic commerce raises: when an AI agent does the shopping, location signals like IP addresses mean nothing. The wallet that pays is the one signal that is hard to fake, and PayPal has wallets in about 200 markets.

### Prior art, stated honestly

Regional pricing exists: game stores and streaming services set prices per country. Creator tools offer "parity" discounts: most go by IP location, which VPNs defeat, and Gumroad's can also require that the buyer's location matches the country of their payment method, so checking the payment method is not new either. Apps that show a price as hours of the user's own wage also exist. What is new here: the price is expressed in time, residence is proven by the wallet at settlement, it holds when the buyer is an AI agent, and richer buyers can cover part of someone else's price.

## 2. Goals, non-goals, anti-goals

### Goals

1. Show any price as hours of average local income, for about 200 countries, from public World Bank data.
2. Quote a fair price per country from the seller's rules. Code computes every amount.
3. Settle with proof: authorise, read the payer country from PayPal, then capture or void. A mismatch takes no money and gets a plain explanation and the right price.
4. A clerk agent that talks to buyers in their language, explains the price, and can lower it for someone whose circumstances differ from their wallet's country, only from the pool (opened by the seller with $20, then filled by buyers' gifts) and only inside the seller's caps.
5. A seller console: the rules, what the price costs in each country, every sale and every refused attempt.
6. The same price desk for AI shopping agents over MCP.
7. Judges can try it with published sandbox buyer logins, and can also see recorded real sandbox runs without logging in.

### Non-goals

- Tax, VAT or invoicing rules per country. Currency conversion: every amount is in USD.
- Verifying a buyer's story beyond what the seller's caps allow the clerk to grant.
- Seller sign-up. There is one demo seller with two products.
- Physical goods, shipping, subscriptions.

### Anti-goals

- Capturing money from a buyer whose wallet country does not match the quote.
- The model deciding an amount, a country match or a cap.
- Presenting simulated payments as real. `PAYPAL_FAKE=1` is development only and shows a banner.
- Presenting "hours" as wages. It is average income per person, and the page says so.

## 3. The numbers

- Source: World Bank, GNI per capita, Atlas method, current US$ (indicator `NY.GNP.PCAP.CD`), most recent year per country, stored in `lib/income-data.json` with the retrieval date. 202 countries have a value.
- Income per hour = GNI per capita / 2,000.
- Hours for a price = price / income per hour.
- Fair price = list price x (income of the buyer's country / income of the seller's reference country) ^ (dial / 100), never above the list price, never below `floorPercent` of it, rounded to cents.
- Dial 0: the same dollars everywhere. Dial 100: the same hours everywhere. The demo seller uses 50 and a 15% floor.
- The UI always says "hours of average income" and links the source.

## 4. Flow

Buyer on `/buy/[product]`:

1. Chooses a country. Sees the list price, the fair price, and both in hours, with one sentence of explanation.
2. May talk to the clerk (any language). May add a gift: "cover an hour for someone".
3. Presses Pay with PayPal. The app creates an order with intent AUTHORIZE for the quoted amount and sends the buyer to PayPal to approve.
4. Back on `/purchase/[id]`: the settlement agent reads the payer's country from PayPal. If it matches the quote it places the hold and captures it; if not, it places no hold and the order is left unpaid. The page shows which, with PayPal's ids.
5. On a mismatch the page says what PayPal reported, that nothing was taken, and offers the price for the wallet's country.

An AI shopping agent does the same through MCP: `list_products`, `get_price`, `start_checkout`, `get_purchase`.

## 5. Rules enforced in code (`lib/pricing.ts`)

1. Amounts come only from the quote. The order amount equals the quote's fair price, minus any granted help, plus any gift.
2. Capture is allowed only when PayPal's payer country equals the quote's country, the wallet has not already bought this product, and the amount equals what was authorised.
3. Anything else is voided. If the agent stops early, code voids what is still open. After every settlement code reads the order back from PayPal: a capture PayPal holds is recorded, a hold still open is released. The model's closing message is shown only if it agrees with that reading. If the model is unavailable or its daily allowance is spent, the same rules settle the payment without it.
4. Settlement starts only when PayPal itself reports the order as approved; opening the return address proves nothing. One wallet buys one product once, also when two purchases settle at the same moment.
5. Help from the pool: at most `help.maxPercent` of the list price on what a buyer says alone (20% in the demo), at most `help.maxPercentWithProof` when the clerk has read a document that supports it (50%), never more than the pool holds, at most `help.perMonth` grants a month, and the buyer still pays at least one dollar. The clerk cannot tell whether a document is genuine; the caps bound that risk. The image is not kept. A promise of help lapses after 60 minutes if the buyer does not pay, and help the pool can no longer cover is not taken: the payment is released.
6. A gift goes to the pool only after its payment is captured. A refund sends back what the buyer paid for the product; the gift stays in the pool, and help the pool paid towards that sale returns to it.
7. Every decision is logged with PayPal's ids. The UI says "captured" only after reading the capture back from PayPal. The seller's ledger shows a sale reference, never the id that opens a buyer's page.
8. Daily caps, counted separately: clerk replies, model settlements, orders created at PayPal. Request bodies are read with a byte limit, PayPal and model calls have time limits, and stale quotes and unpaid purchases are forgotten.

What this does not stop: someone paying with a wallet lent by a person in another country. One purchase per wallet per product limits it. The seller console has no sign-in in this demo, so anyone who opens it can refund a sandbox sale once.

## 6. Architecture

One Next.js app, state in memory, same shape as before.

```
lib/income-data.json   World Bank table
lib/types.ts           contracts
lib/pricing.ts         pure functions: hours, fair price, quote, capture decision, help limits
lib/store.ts           purchases, quotes, pool, event bus
lib/seller.ts          the demo seller, products and rules
lib/paypal.ts          real backend: create/authorize/capture/void/refund, order details
lib/paypal-fake.ts     development backend with a local approval page
lib/agent.ts           model client, shared tool loop, settlement agent
lib/clerk.ts           the clerk: greeting, conversation, documents, help and gifts
lib/shop.ts            quotes, purchases, checkout, ledger, refunds (shared by routes and MCP)
lib/mcp.ts             the price desk for AI shoppers
app/page.tsx                     landing
app/buy/[product]/page.tsx       quote, clerk, pay
app/purchase/[id]/page.tsx       settlement and result
app/seller/page.tsx              rules, world table, ledger, pool
app/api/...                      quote, purchases, clerk, return, events, seller, mcp, dev approval
```

- Model: OpenAI-compatible chat completions, injectable, with a scripted stand-in for tests.
- PayPal: Orders v2 (create with intent AUTHORIZE, authorize, details), Payments v2 (capture authorization, void authorization, refund capture). The PayPal Agent Toolkit serves `get_order` and `create_refund`; the rest is REST.
- Payer country: `payer.address.country_code` on the approved order, falling back to `payment_source.paypal.address.country_code`.

## 7. Not yet verified (no credentials at design time)

- That the sandbox returns the payer's country on an approved order.
- That sandbox buyer accounts can be created for the countries used in the demo.
- Automated approval of a sandbox checkout in a headless browser.

If the payer country cannot be read, the idea does not stand and the owner is told at once.

## 8. Needed from the owner

1. A funded LLM key.
2. A PayPal developer account with one US sandbox business app (client id and secret).
3. Sandbox personal accounts in two countries (Viet Nam and Germany), with their email and password, to be published in the README for judges.
4. Render account, YouTube upload, Devpost submission.
