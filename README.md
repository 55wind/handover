# Fair Hour

**Priced in hours, not dollars. A clerk who listens. Proven by the wallet, not the IP address.**

A $44.00 video course costs 1.0 hour of average income in the United States and 17.7 hours in Viet Nam. The price tag is the same in both countries, and what it costs the buyer is not. Fair Hour lets a small seller of digital goods quote each buyer a price that costs a comparable amount of local income, inside limits the seller sets: with the demo seller's rules the same course is $10.41 in Viet Nam, or 4.2 hours. An AI clerk explains the price in the buyer's language and can take a little off for someone whose situation is harder than their country suggests, and PayPal confirms which country the paying wallet is registered in before any money is taken.

Built for the PayPal AI Hackathon 2026. Runs on the PayPal sandbox. The seller and buyers are fictional. No real money moves.

- Live demo: _added at submission_
- Video: _added at submission_

## What a purchase looks like

1. **Country and price.** The buyer chooses the country their PayPal wallet is registered in. The page shows the list price, the fair price for that country, and both in hours of average income there, with one sentence on why.
2. **The clerk.** An AI clerk greets the buyer in their language and explains the price in hours. The buyer can say that their situation is harder than their country suggests (studying abroad, out of work, a small pension) and can show a document such as a student card. The clerk can then take an amount off, inside caps the seller set. The money comes from a pool that the seller opened with $20.00 and that buyers add to with gifts. The clerk does not bargain: asking for a lower price is not a reason.
3. **A gift, if the buyer wants.** The buyer can add $2.00 or $5.00 to "cover an hour for someone". The gift goes into the pool once its payment has been captured.
4. **Pay with PayPal.** The shop creates a PayPal order with intent `AUTHORIZE` for the agreed amount and sends the buyer to PayPal to approve it. Approving takes no money.
5. **The wallet check.** A settlement agent asks PayPal which country the approving wallet is registered in. If it is the quoted country, the agent has PayPal hold the amount and then capture it. The page shows each step as it happens, then a receipt with PayPal's order, authorisation and capture ids. It says "Confirmed with PayPal" only after the capture has been read back.
6. **On a mismatch.** If the wallet is registered in another country, no hold is placed and nothing is taken. The page says which country PayPal reported and offers the price for that country, which the buyer can accept with one more approval.

The seller's console at `/seller` shows the rules, every sale and every released payment with the reason, the pool, and what each product costs in 202 countries.

### Example prices

The course "Hand lettering basics", list price $44.00, under the demo seller's rules: the list price is set for the United States, the dial is at 50 and the floor is 15% of the list price.

| Country | Hours at the list price | Fair price | Hours at the fair price |
|---|---:|---:|---:|
| United States | 1.0 | $44.00 | 1.0 |
| Norway | 0.9 | $44.00 | 0.9 |
| Germany | 1.5 | $36.23 | 1.2 |
| Japan | 2.3 | $28.91 | 1.5 |
| Brazil | 8.3 | $15.17 | 2.9 |
| Viet Nam | 17.7 | $10.41 | 4.2 |
| India | 31.9 | $7.76 | 5.6 |
| Nepal | 55.7 | $6.60 | 8.4 |

Norway pays the list price because the seller never charges more than it. Nepal pays the floor, $6.60. Under these rules 35 of the 202 countries pay the floor and 5 countries with a higher income than the United States pay the list price.

## Who does what

A neighbourhood shopkeeper knows who is a student and who has had a hard month, and takes a little off. Online checkout has no such discretion. Fair Hour gives that discretion to an AI clerk, and gives the parts that must not be fooled to PayPal and to code.

| Part | Who | What |
|---|---|---|
| Listening and judging | The clerk (LLM) | Opens the conversation in the buyer's language, explains the price in hours, hears a situation, reads a document in any country's format, decides whether and how much to help, records a gift. It does not bargain. |
| Proof of residence | PayPal | Reports the country the paying wallet is registered in. |
| Limits | Code | Every amount, the country match, the help caps, the pool balance. Help comes only from the pool and never exceeds what it holds. The seller opened the pool with $20.00; after that buyers fill it with gifts. |
| Settlement | The settlement agent (LLM with tools) | Reads the order, holds, takes or releases the payment, and tells the buyer what happened in their language. Code refuses any step the rules do not allow, releases whatever is left open, and settles by the same rules itself when the model is not available. |

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.png">
  <img alt="Architecture of Fair Hour. A buyer in a browser picks a country on the buy page and talks to the clerk. An AI shopping agent reaches the same prices through the MCP price desk. Inside one Next.js process, the clerk and the settlement agent call a language model, and both act only through rules written in code, which read a World Bank income table and write to a ledger and pool held in memory. The buy page creates an order on the PayPal sandbox and the buyer approves it. PayPal reports the wallet's country to the settlement agent, and the rules then allow a hold and a capture, or a release." src="docs/architecture.png" width="760">
</picture>

The blue path is one purchase, from picking a country to the capture or release at PayPal; the source of the picture is [docs/architecture.html](docs/architecture.html).

- **Rules** (`lib/pricing.ts`): pure functions with unit tests. Hours, fair price, the amount due, help limits, and the decision to capture.
- **Seller** (`lib/seller.ts`): the one demo seller, two products and the rules.
- **Shop** (`lib/shop.ts`): quotes, purchases, starting a checkout, the sales ledger, refunds. The web routes and the MCP endpoint both call it.
- **Clerk** (`lib/clerk.ts`): the clerk's prompt and its tools: `price_for_country`, `pool_status`, `help_limit`, `grant_help`, `set_gift`, `record_evidence`.
- **Settlement agent** (`lib/agent.ts`): the model client (OpenAI-compatible chat completions), the tool loop both agents share, and the settlement agent's tools: `read_order`, `hold_payment`, `take_payment`, `release_payment`, `finish`.
- **PayPal** (`lib/paypal.ts`): the sandbox backend. `lib/paypal-fake.ts` is a stand-in for development and tests.
- **MCP price desk** (`lib/mcp.ts`, `app/api/mcp/route.ts`): the same prices and checkout for AI shopping agents.
- **Store** (`lib/store.ts`): purchases, quotes, the pool and the event stream, in memory.
- **Income table** (`lib/income-data.json`): World Bank figures for 202 countries.
- **Pages**: `app/page.tsx` (start), `app/buy/[product]/page.tsx` (price, clerk, pay), `app/purchase/[id]/page.tsx` (settlement and receipt, streamed over server-sent events), `app/seller/page.tsx` (rules, ledger, pool and a price table in AG Grid).

The agents and the rules run in one process. The model is never given PayPal credentials. It can only ask for the tools listed above, and the code behind each tool applies the rules before PayPal is called.

## What the code decides, not the model

1. **Amounts.** The amount PayPal is asked to hold is the quote's fair price, minus any help the clerk granted, plus any gift. Code computes it. A quote is valid for 30 minutes, and the payment has to start within 60 minutes of the purchase being opened. After that the price lapses, and so does any help promised with it.
2. **The country match.** A payment is captured only when PayPal's payer country equals the quoted country, the wallet has not already bought this product, and the amount PayPal holds equals the amount agreed. The check runs on a fresh read of the order from PayPal, never on what the model remembers. One wallet buys one product once, also when two purchases from it settle at the same moment.
3. **Everything else is released.** If the country does not match, no hold is placed. If the model asks for a step the rules do not allow, the step is refused and the model is told why. If the model stops early, code releases whatever is still open.
4. **Settlement does not depend on the model.** When the day's allowance of model runs is spent, or the model call fails, code takes the same steps under the same rules. Nothing a buyer approved is left hanging.
5. **Help from the pool.** At most 20% of the list price on what a buyer says alone, and at most 50% when the clerk has read a document that supports it. Never more than the pool holds, counting help already promised to other open purchases. At most 30 times a month. The buyer still pays at least $1.00. If the pool can no longer cover promised help when the payment is settled, the payment is released. The image of a document is not kept, only what kind it was and whether it supported what the buyer said.
6. **Gifts and refunds.** A gift enters the pool only after its payment is captured. A refund sends back what the buyer paid for the product, which is the amount paid minus any gift. The gift stays in the pool, since it may already have been spent on someone else, and help the pool paid towards the refunded sale goes back into the pool.
7. **PayPal's record decides.** After every settlement, whatever the model did, code reads the order back from PayPal. A capture PayPal holds is recorded, and a hold that is still open is released. The page says "Confirmed with PayPal" only from that reading, and the model's closing message is shown to the buyer only if it agrees with it; otherwise a plain sentence written by code is shown. If PayPal cannot be read at that moment, the result is shown as unconfirmed and PayPal is asked again when the purchase is next looked at.
8. **The return address proves nothing.** Anyone can open the address PayPal sends the buyer back to. Settlement starts only if PayPal itself reports the order as approved.
9. **What the seller sees.** The seller's ledger and the pool list show a sale reference, not the id that opens the buyer's page and conversation with the clerk.

**What this does not stop.** Someone can pay with a wallet lent by a person in another country. Each wallet can buy a product once, which limits how far that goes and does not prevent it. The clerk reads a document but cannot tell whether it is genuine, so a forged one can get help up to the 50% cap, paid from the pool and only while the pool has money. And a country average is crude: it says nothing about one buyer. A well-paid buyer in a low-income country gets the low price, and a hard-up buyer in a high-income country gets the high one unless they tell the clerk. The country is where the wallet is registered, which may not be where its owner lives today.

## What is real and what is not

PayPal calls. The base address is fixed in code to `https://api-m.sandbox.paypal.com`, so this project cannot call live PayPal.

| Step | Call | Through |
|---|---|---|
| Sign in | `POST /v1/oauth2/token` | REST |
| Create the order, intent `AUTHORIZE`, PayPal as the payment source | `POST /v2/checkout/orders` | REST |
| Read the order, including the payer's country | `GET /v2/checkout/orders/{id}` | PayPal Agent Toolkit, `get_order` |
| Place the hold | `POST /v2/checkout/orders/{id}/authorize` | REST |
| Take the payment | `POST /v2/payments/authorizations/{id}/capture` | REST |
| Release the hold | `POST /v2/payments/authorizations/{id}/void` | REST |
| Refund from the seller's ledger, in full or without the gift | `POST /v2/payments/captures/{id}/refund` | PayPal Agent Toolkit, `create_refund` |

- The payer's country is read from `payer.address.country_code` on the order, and from `payment_source.paypal.address.country_code` if the first is absent.
- Authorising, capturing and refunding each carry a `PayPal-Request-Id` fixed per order or purchase, so a repeated request does not act twice.
- Every amount is in USD. There is no currency conversion and no tax or VAT handling.
- Purchases, quotes, the pool and the record of which wallet bought which product live in memory. A restart clears them and puts the pool back at $20.00.
- The pool is bookkeeping inside the app, not a separate PayPal balance. It starts at $20.00 from the seller (`POOL_SEED` in `lib/seller.ts`, the first entry in the pool list). A gift is captured into the seller's sandbox account together with the giver's own purchase, and help is drawn against the pool's balance.
- There is one demo seller with two products and no seller sign-up. The rules are fixed in `lib/seller.ts`. The dial and floor sliders on the seller page are a preview in the browser.
- The seller console has no sign-in in this demo. Anyone who opens it can refund a sandbox sale, once per sale.
- A document shown to the clerk must be a PNG, JPEG or WebP image under 4 MB. It is passed to the model for that one reply and not stored.
- Three daily caps, each counted on its own: 300 clerk replies that use the model (`DAILY_CLERK_LIMIT`), 200 settlements that use the model (`DAILY_SETTLE_LIMIT`) and 400 orders created at PayPal (`DAILY_CHECKOUT_LIMIT`). Past the settlement cap, approved payments are still settled, by the rules without a model.

`PAYPAL_FAKE=1` replaces PayPal with an in-memory stand-in and a local approval page that offers eight made-up wallets in eight countries. `LLM_SCRIPTED=1` replaces the language model with a fixed script that answers in English and accepts any attached image as supporting. Both exist for development and tests only. Either one puts a "DEVELOPMENT MODE" banner on every page, and neither is set on the hosted demo.

**Status.** At the time of writing, the flow has been verified end to end only against the development stand-in for PayPal and the scripted stand-in for the model (`npm run e2e`, described below). Verification on the real PayPal sandbox and with a real language model is pending. The first thing the sandbox run has to confirm is that PayPal reports the payer's country on an approved order, because the whole idea rests on it. This paragraph will be replaced with the results of those runs.

## Where the numbers come from

- **Source.** World Bank, GNI per capita, Atlas method, current US$, indicator [`NY.GNP.PCAP.CD`](https://data.worldbank.org/indicator/NY.GNP.PCAP.CD). Retrieved 2026-11-12, most recent year available for each country: 2025 for 182 of the 202 countries, 2019 to 2024 for the rest. The table is `lib/income-data.json`.
- **Income per hour** = GNI per capita / 2,000. United States: $88,810 / 2,000 = $44.41. Viet Nam: $4,970 / 2,000 = $2.49.
- **Hours for a price** = price / income per hour, to one decimal. $44.00 / $44.41 = 1.0 hour. $44.00 / $2.49 = 17.7 hours.
- **Fair price** = list price x (income of the buyer's country / income of the seller's reference country) ^ (dial / 100), never above the list price, never below the floor, rounded to cents. At dial 0 every country pays the same dollars. At dial 100 every country pays the same hours, as far as the two limits allow. Viet Nam at dial 50: $44.00 x (4,970 / 88,810) ^ 0.5 = $10.41.

"Hours" here are hours of average income per person, not wages. GNI per capita divides a country's income by its whole population, children and retired people included, and 2,000 is a round figure for a year of full-time work. Nobody's actual pay is used. The pages say "hours of average income" wherever a figure appears.

## Prior art

Regional pricing is not new. Game stores and streaming services set prices per country. Creator tools offer "parity" discounts: most go by the visitor's IP address, which a VPN defeats, and Gumroad's can also require that the buyer's location matches the country of their payment method. So checking the payment method is not new either. What is different here:

- The price is stated in time, so buyer and seller can see what it costs in each place.
- Residence is read from the PayPal wallet before any hold is placed. A mismatch takes no money and is offered the right price.
- The check still works when an AI agent does the shopping, where the request's IP address says nothing about the person paying.
- A pool, opened by the seller and added to by buyers, lets a clerk lower the price for one person, inside caps.

## For AI shopping agents (MCP)

The same price desk is an MCP server at `POST https://<your-host>/api/mcp` (Streamable HTTP, stateless, JSON responses).

- `list_products`: the products and their list prices in USD.
- `get_price`: takes `product_id` and `country`. Returns the list price, the fair price, what each costs in hours of average income, and a quote id valid for 30 minutes.
- `start_checkout`: takes `quote_id`. Returns a PayPal link the buyer has to approve, the amount, and a purchase id.
- `get_purchase`: takes `purchase_id`. Says whether the purchase is waiting for approval, paid, or released, and gives the price for the wallet's country after a release.

An agent can ask for the price of any country. It cannot choose the country that is charged: that comes from the wallet that approves the payment, so claiming another country ends in a release. The clerk is on the web page only.

With Claude Code, for example:

```
claude mcp add --transport http fair-hour https://<your-host>/api/mcp
```

Then ask it what the lettering course costs for a wallet in Viet Nam and to start a checkout.

## Run it yourself

Requirements: Node 22 or later, a PayPal developer account, and an API key for a provider with an OpenAI-compatible chat completions endpoint. The model needs tool calls, and image input if the clerk is to read documents.

1. In the [PayPal developer dashboard](https://developer.paypal.com/dashboard/), create one **US** sandbox business account and a REST app for it. This is the seller. Create sandbox personal accounts in two countries, for example Viet Nam and Germany, to pay with.
2. Copy `.env.example` to `.env.local` and fill in the model settings (`OPENAI_API_KEY`, `LLM_MODEL`, and `OPENAI_BASE_URL` if the provider is not OpenAI), the seller app's `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`, and `APP_URL`, the address PayPal sends the buyer back to.
3. `npm install`
4. `npm run probe` signs in to the sandbox, creates one $1.00 order with intent `AUTHORIZE` and prints its approval link. Open the link and approve with a sandbox buyer, then run `npx tsx scripts/probe.ts <order id>`. It prints the order as PayPal returns it and the payer country the app reads from it, places the hold and voids it. It never captures.
5. `npm run dev`, then open http://localhost:3000.

To look around without any account, put `PAYPAL_FAKE=1` and `LLM_SCRIPTED=1` in `.env.local` instead of the keys. Nothing in that mode is real, and the banner says so.

Checks:

- `npm test`: 37 unit tests. They cover the rules (fair price, dial and floor, hours, the amount due, the help limits, the decision to capture) and the development stand-in for PayPal (approve, authorise, capture, void, full and partial refund, and the requests it must refuse).
- `npm run e2e`: more than twenty cases through the whole flow in one process, on the stand-in for PayPal, because a real sandbox checkout needs a person to approve it in a browser. It uses the configured model when `OPENAI_API_KEY` and `LLM_MODEL` are set and the scripted stand-in otherwise; `E2E_SCRIPTED=1` forces the stand-in. It checks:
  - **The country.** A Viet Nam quote paid from a Viet Nam wallet is captured at $10.41 and confirmed. The same quote paid from a German wallet ends with no hold, no capture and an offer of the German price, $36.23. One wallet cannot buy the same product twice, one after the other or both at the same moment.
  - **The pool.** It opens with the seller's $20.00, and a $5.00 gift reaches it after capture. The clerk helps a student inside the 20% cap, gives nothing from an empty pool and does not bargain. A supporting document raises the cap to 50% (asserted with the scripted stand-in). A promise of help lapses after 60 minutes, and a promise the pool can no longer cover ends in a release.
  - **A model that misbehaves.** One that tries to capture across countries is refused. One that stops after the hold has the hold released by code. One that places a new hold after a release is refused. One that says "paid" after a release is overruled: the buyer is told what PayPal shows.
  - **PayPal failing.** An error during capture releases the hold and shows nothing as paid. A capture whose answer is lost is still recorded as paid, and its gift enters the pool once. A capture answered with a status that is not a payment is not recorded as one. When PayPal cannot be read for the closing check, the result is shown as unconfirmed and is confirmed on a later look.
  - **Agents and limits.** An AI shopping agent over MCP that asks for the Viet Nam price and pays from a US wallet is released and offered the US price. Opening the return address before the buyer approved settles nothing. With the model allowance spent, the rules alone capture a matching wallet and release a mismatched one.
  - **Refunds.** A sale with a $5.00 gift sends $44.00 back and keeps the gift in the pool. It cannot be refunded twice, and the buyer's own id does not work at the seller's desk. Help on a refunded sale returns to the pool and is not counted as a new grant.
  - **At the end.** No captured sale has a wallet country different from its quoted country, nothing is left held at the stand-in, and the ledger agrees with it sale by sale.

Output of `E2E_SCRIPTED=1 npm run e2e` at the time of writing:

```
model: scripted stand-in   paypal: development stand-in
  Viet Nam price, Viet Nam wallet      quoted VN $10.41  wallet VN  -> captured, confirmed  paid $10.41
  Viet Nam price, Germany wallet       quoted VN $10.41  wallet DE  -> voided, confirmed  paid $0.00
  Same wallet, second time             quoted VN $10.41  wallet VN  -> voided, confirmed  paid $0.00
  two at once from one wallet            one taken, one released
  Norway, with a $5 gift               quoted NO $44.00  wallet NO  -> captured, confirmed  paid $49.00
  Germany wallet, student from Nepal   quoted DE $36.23  wallet DE  -> captured, confirmed  paid $27.43
  empty pool                             the clerk gave nothing
  no bargaining, gift on request         gift $5.00, pays $41.23
  help on a word / with a document       $2.40 / $22.00
  promised help, pool since emptied      released, nothing taken
  Misbehaving model, India price       quoted IN $ 7.76  wallet US  -> voided, confirmed  paid $0.00
  Model stops after the hold           quoted BR $15.17  wallet BR  -> voided, confirmed  paid $0.00
  Hold after release                   quoted NG $ 6.60  wallet NG  -> voided, confirmed  paid $0.00
  model claims "paid" after a release    buyer is told: Nothing was taken. PayPal reports this wallet is registered ...
  PayPal error during capture          quoted NP $ 6.60  wallet NP  -> voided, confirmed  paid $0.00
  Capture answer lost                  quoted US $44.00  wallet US  -> captured, confirmed  paid $46.00
  Capture declined by PayPal           quoted BR $ 4.14  wallet BR  -> voided, confirmed  paid $0.00
  PayPal unreachable for the check       shown as unconfirmed, confirmed on a later look
  AI agent over MCP, US wallet         quoted VN $ 2.84  wallet US  -> voided, confirmed  paid $0.00
  No model allowance left              quoted NO $12.00  wallet NO  -> captured, confirmed  paid $12.00
  refunds                                $44.00 back, gift kept; help of $8.80 returned to the pool
  ledger: 21 sales, 5 captured, 14 released, pool $20.80
E2E PASSED
```

"voided" is PayPal's word for a released payment. On those lines "confirmed" means the read-back from the stand-in showed no capture and no open hold.

`render.yaml` describes the hosted demo as one Render web service on Node 24, with the three daily caps.

## Tools and models used

- PayPal: Orders v2 (create with intent `AUTHORIZE`, show details, authorize), Payments v2 (capture an authorization, void an authorization, refund a capture), the [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit) for `get_order` and `create_refund`, and the PayPal sandbox.
- Model: _filled in at submission_, through an OpenAI-compatible chat completions endpoint, for the clerk (conversation, reading a document) and the settlement agent (tool calls and the message to the buyer).
- Model Context Protocol for the price desk.
- Next.js, React and TypeScript. AG Grid Community for the seller's ledger and price table.
- World Bank Open Data for the income figures.
- Claude Code (Anthropic) wrote most of the code and documents under the author's direction.

## License

MIT. See [LICENSE](LICENSE).
