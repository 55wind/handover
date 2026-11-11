# Devpost submission text

Paste each block into the matching field. Items marked TODO depend on the real sandbox run or the deployment and are filled in after them.

## Project name

Fair Hour

## Elevator pitch (tagline)

Priced in hours, not dollars. An AI clerk who listens, and a PayPal wallet that proves where the buyer lives before any money is taken.

## About the project

### Inspiration

A price tag reads the same number everywhere, but it does not cost the same. A $44.00 course is 1.0 hour of average income in the United States and 17.7 hours in Viet Nam.

A neighbourhood shopkeeper handles this by knowing the customers: who is a student, who has had a hard month. Online checkout has no such discretion. Its usual substitute, a discount based on the IP address, is defeated by a VPN and means nothing when an AI agent does the shopping. The wallet that pays is much harder to fake.

### What it does

Fair Hour lets a small seller of digital goods price in hours of average local income instead of dollars.

- Code works out a fair price for 202 countries from World Bank income data and the seller's rules. The demo course is $44.00 in the United States, $36.23 in Germany, $10.41 in Viet Nam and $6.60, the floor, in Nepal.
- An AI clerk greets each buyer in their language, explains the price in hours and listens. It can take a little off for someone whose situation is harder than their country suggests, and more if they show a document. The money comes from a pool the seller opened with $20.00 and buyers add to with gifts. The clerk does not bargain.
- The buyer approves a PayPal order that is only authorised. A settlement agent reads the payer's country from PayPal and captures if it matches the quote. If not, nothing is taken and the buyer is offered the price for their wallet's country.
- AI shopping agents get the same price desk over MCP, with the same check.

### How we built it

- One Next.js app on the PayPal sandbox: Orders v2 with intent `AUTHORIZE`, Payments v2 to capture or void the authorisation, and refunds. `get_order` and `create_refund` go through the PayPal Agent Toolkit; the rest is REST.
- Two agents on an OpenAI-compatible chat completions endpoint share one tool loop. Every tool call passes through the rules.
- The rules are pure functions with unit tests. After every settlement, code reads the order back from PayPal and records what PayPal shows.
- An MCP endpoint with four tools, and AG Grid for the seller's ledger and price table.

### Challenges we ran into

- A sandbox checkout needs a buyer to approve it in a browser, so the automated end-to-end check runs on a stand-in for PayPal that follows the same order states. The real sandbox is checked by hand.
- Deciding what the model may decide. It proposes and explains. Code sets every amount and the country match, and settles by the same rules itself if the model is unavailable.
- Keeping "hours" honest. The figure is average income per person divided by 2,000 hours, not a wage, and every page says so.
- Who pays for kindness. A clerk that could discount freely would cost the seller money for every good story. Help comes only from the pool, so the seller's cost is capped at the $20.00 they put in.

### Accomplishments that we're proud of

- A mismatch takes no money. In the end-to-end check, a Viet Nam quote paid from a German wallet ends with no hold, no capture and an offer of the German price.
- That check runs more than twenty cases on the stand-in, including a model that tries to capture across countries, a model that says "paid" after a release, and a capture whose answer is lost. None ends with money wrongly taken or a hold left open.
- TODO after the real sandbox run: one sentence on what was captured and released there.

### What we learned

- A payment agent is safest with narrow, reversible tools: authorise first, capture only on proof, and trust PayPal's record over the model's account of it.
- A language model suits what a shopkeeper does: listening in any language and reading an unfamiliar document. It does not suit arithmetic and limits.
- TODO after the real sandbox run: whether the payer's country arrives on the approved order, and in which field.

### What's next

- A database for sales and the pool, seller sign-up, and a sign-in for the seller console.
- Currency conversion and tax. Every amount is in USD today.
- Finer data than a national average.
- Real document checks. Today the caps bound the cost of a forged one.

## Built with

PayPal Orders API, PayPal Payments API, PayPal Agent Toolkit, PayPal sandbox, Model Context Protocol, Next.js, React, TypeScript, AG Grid, World Bank Open Data, OpenAI-compatible LLM API (TODO: model name), Render (TODO: confirm after deployment)

## AI tools used and how

- TODO model name, through an OpenAI-compatible chat completions endpoint. It runs the clerk (conversation in the buyer's language, reading a document image, deciding through tool calls whether and how much to help) and the settlement agent (reads the order, holds, captures or releases through tool calls, and writes the message to the buyer).
- Claude Code (Anthropic): wrote most of the code, tests and documents under the author's direction.
- TODO if used: any tool used for the video, such as text-to-speech for the voiceover.

## PayPal products used and how

- Orders v2: create an order with intent `AUTHORIZE` and PayPal as the payment source, send the buyer to PayPal to approve, read the order to get the payer's country (`payer.address.country_code`), and authorise it to place the hold.
- Payments v2: capture the authorisation when the country matches, void it otherwise, and refund a capture from the seller's ledger, in full or without the gift.
- PayPal Agent Toolkit (`@paypal/agent-toolkit`): `get_order` and `create_refund`.
- PayPal sandbox: one US business app as the seller, and personal accounts in Viet Nam and Germany as buyers (TODO: confirm the accounts after they are created).
- TODO after the real sandbox run: confirm which field carried the payer's country.

## Links

- Repository: https://github.com/55wind/handover (TODO: update if the repository is renamed)
- Live demo: TODO
- Video: TODO

## Testing instructions for judges

TODO before submitting: check these steps and button labels against the deployed build.

No login is needed for the app itself. You pay with these sandbox buyer accounts:

- Viet Nam wallet: TODO email / TODO password
- Germany wallet: TODO email / TODO password

1. Open the live demo (TODO link) and press "Buy as someone in Viet Nam". The course is $10.41 for Viet Nam: 4.2 hours of average income, against 17.7 hours at the list price of $44.00.
2. The clerk. Ask it for a discount, in any language: it does not bargain. Then tell it you are a student on a small scholarship. It can take up to 20% of the list price off, paid from the pool, which the seller opened with $20.00.
3. A matching wallet. Press "Pay with PayPal" and log in with the Viet Nam wallet. The agent reads the wallet's country from PayPal, holds the payment and captures it. The receipt shows PayPal's ids and "Confirmed with PayPal".
4. A mismatch. Open the course again with Viet Nam selected and pay with the Germany wallet. Nothing is taken. The page says PayPal reported Germany and offers the German price, $36.23.
5. A gift. Choose Germany on the buy page, add a $5.00 gift and pay with the Germany wallet: $36.23 plus the gift, $41.23. After the capture the pool has grown by $5.00.
6. Open "What the seller sees" (`/seller`): the rules, every sale and released payment, the pool, and what each product costs in 202 countries. A captured sale can be refunded there. The buyer gets back what they paid for the product, and a gift stays in the pool. The console has no sign-in in this demo.
7. As an AI agent: `claude mcp add --transport http fair-hour https://TODO-host/api/mcp`, then ask for the price of the lettering course for a wallet in Viet Nam and to start a checkout.

Notes. Each wallet can buy each product once. To buy again, refund the sale on the seller page or choose the other product. A price has to be paid within 60 minutes. Sales and the pool live in memory: a restart clears the sales and puts the pool back at $20.00. The demo allows 300 clerk replies and 400 PayPal orders a day. Approved payments are always settled: 200 a day with the model, and by the rules in code after that.
