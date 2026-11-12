# Devpost submission text

Paste each block into the matching field. Every line marked TODO still has to be filled in or checked before submitting.

## Project name

Have You Eaten?

## Elevator pitch (tagline)

Tell an agent who you miss. It buys them a meal at the shop next door, and you pay only when they eat.

## About the project

### Inspiration

In many languages "have you eaten?" is how people say they care. When the person you care about lives in another city or country, you cannot put a bowl of soup in front of them.

What exists today is a gift card or a coupon app. It takes the money at once, works at one chain in one country, and the money is gone if the gift is never used. The sender also has to know the shops, the menu and often the language.

### What it does

Have You Eaten? lets someone far away buy a person they care about a meal at a neighbourhood shop near that person.

- The sender writes one sentence: "My mom in Busan has a cold, get her something warm tonight." An errand agent looks up shops near her, picks a dish and writes the card in her language.
- PayPal holds the money (an order with intent AUTHORIZE) and takes none of it.
- The recipient gets a link with the card, the dish and a code. She never sees a price. A host agent talks to her in her language. It can change the dish within what is held, pass on a thank-you, or take a polite no.
- At the shop's counter she shows the code. A till agent takes exactly the price of what she ate with a final capture, which releases the rest of the hold, and pays the shop with a PayPal payout.
- If the treat is declined, cancelled or not used in three days, the hold is voided and nothing is taken.
- Other people's AI assistants can use the same desk over MCP: `find_treats`, `send_treat`, `treat_status`.

Every amount and every yes-or-no about money is decided in code, not by a model. After each settlement the code reads the order back from PayPal, and the page says "Confirmed with PayPal" only from that reading.

It runs on the PayPal sandbox, with 11 fictional shops in five cities.

### How we built it

- One Next.js app (React, TypeScript) on the PayPal sandbox.
- PayPal: Orders v2 with intent `AUTHORIZE`, authorize, a final capture of part of the authorisation, void, and Payouts. Every read of an order goes through the PayPal Agent Toolkit's `get_order`. The other calls are plain REST.
- Three agents (errand, host, till) share one tool loop. The model is Claude Haiku 5.5 through the Claude API (Anthropic's SDK); an OpenAI-compatible endpoint works too.
- The rules are pure functions in `lib/rules.ts`. Each tool call of an agent passes through them before PayPal is called.
- An MCP endpoint with three tools, and AG Grid for the ledger.
- Menu prices are in the shop's own currency. The dollar price comes from a fixed exchange-rate table dated 2026-11-12, because PayPal does not support every local currency.

### Challenges we ran into

- Taking only what was eaten. The hold is larger than the dish, so the recipient has room to choose something else. At the counter a capture with `final_capture: true` takes the price and releases the rest. This had to be seen on the real sandbox before building on it.
- A sandbox checkout needs a person to approve it in a browser. The automated end-to-end check therefore runs on a stand-in for PayPal that follows the same order states, and the real sandbox is checked with two scripts in which a person approves.
- Deciding what the model may decide. It chooses a dish and writes words. It never sets an amount: the tools that take money have no arguments, and code refuses any step the rules do not allow.
- Keeping the price from the recipient. The host agent is never given a price, so it cannot mention one.
- PayPal does not support the Korean won, so orders are in US dollars and each dish is converted at a dated rate, rounded up to a cent.

### Accomplishments that we're proud of

- One whole treat on the real PayPal sandbox (2026-11-12, with the scripted stand-in as the model): $14.00 was held after a sandbox buyer approved; the recipient changed abalone porridge to vegetable porridge; at the counter $6.74 was captured, the authorisation closed and the other $7.26 was released; a payout of $6.74 to the shop account was accepted.
- A model cannot serve a treat by saying so. In the end-to-end check, a till model that pays the shop first, never takes the payment and then reports "served" serves nothing, and no shop is paid.
- A capture whose answer is lost is still found, because code reads PayPal back after every settlement, and the shop is paid once.
- With the real model on the real sandbox: the errand agent chose abalone porridge for a mother with a cold and wrote the card in Korean, the host agent changed it to vegetable porridge when she said she cannot eat seafood, and the till agent took $6.74 of the $14.00 held and paid the shop. An 18-check eval passes, at about $0.001 of model cost per treat.

### What we learned

- A final capture of part of an authorisation closes it. On the sandbox, after $2.10 of a $5.00 hold was captured with `final_capture: true`, the order showed the authorisation as `CAPTURED` with a captured amount of 2.10.
- A payout is accepted first and settled later. The sandbox answered `PENDING`, then `PROCESSING`. A ledger has to show that status, not a plain yes.
- A payment agent is safest with narrow tools that take no amounts, and with PayPal's record trusted over the model's account of it.
- A language model suits the part a far-away sender cannot do: choosing from a menu in another country and writing the card in another language. It does not suit arithmetic and limits.

### What's next

- A database, so treats outlive a restart.
- Real shops, each with its own PayPal account and a sign-in for the counter screen.
- Live exchange rates, payouts in the shop's own currency, and PayPal's fees.
- Refunds for a treat that went wrong.
- More cities.

## Built with

PayPal Orders API, PayPal Payments API, PayPal Payouts API, PayPal Agent Toolkit, PayPal sandbox, Model Context Protocol, Next.js, React, TypeScript, Node.js, AG Grid, Claude API (Claude Haiku 5.5), Anthropic TypeScript SDK, Render (TODO: confirm after deployment), Claude Code

## AI tools used and how

- Claude Haiku 5.5 (`claude-haiku-5-5`) through the Claude API, with tool calling, prompt caching and low thinking effort. It runs three agents. The errand agent turns the sender's sentence into a dish at a shop near the recipient and writes the card in two languages. The host agent talks to the recipient in their language and can change the dish, note a visit, pass on a thank-you or take a no. The till agent reads the PayPal order, takes the price, pays the shop and writes one sentence each for the shop and the sender. All three act only through tools, and code applies the rules behind each tool.
- Claude Code (Anthropic): wrote the code, the tests and the documents under the owner's direction.
- A scripted stand-in for the model exists for development and tests. It is not an AI tool and does not run on the hosted demo.
- TODO if used: any tool used for the video, such as text-to-speech for the voiceover.

## PayPal products used and how

- Orders v2: create an order with intent `AUTHORIZE` and PayPal as the payment source, send the sender to PayPal to approve, authorize it to place the hold, and read the order back after every settlement.
- Payments v2: capture part of the authorisation with `final_capture: true` (the price of the dish; the rest of the hold is released), or void the authorisation when the treat is declined, cancelled or run out.
- Payouts: pay the shop the price of the dish, and read the payout's status until PayPal settles it.
- PayPal Agent Toolkit (`@paypal/agent-toolkit`): `get_order`, for every read of an order. A refund method that uses `create_refund` exists in the code but nothing in the app calls it.
- PayPal sandbox: one US business app as the platform, one personal account as the sender, one account that stands for the shops.

## Links

- Repository: https://github.com/55wind/have-you-eaten
- Live demo: TODO
- Video: TODO

## Testing instructions for judges

TODO before submitting: check these steps and button labels against the deployed build, and replace TODO-host.

No login is needed for the app itself. To approve the hold at PayPal, use this sandbox buyer. It is a PayPal sandbox test account and holds no real money.

- Email: `sb-ydrbf53857778@personal.example.com`
- Password: `2f8"eWq_`

As the sender:

1. Open https://TODO-host/send. Type your name if you want the card signed with it.
2. Write one sentence, for example "My mom in Busan has a cold. Get her something warm tonight.", or press one of the examples. Press "Send to the agent".
3. The agent answers with the dish, the shop, the card in both languages, the price and what PayPal will hold. To change anything, tell the agent.
4. Press "Hold $… with PayPal", log in with the sandbox buyer and approve.
5. You return to the treat's page. It says "PayPal is holding $…" and shows the link to share, the code, the activity log and PayPal's ids. Nothing has been taken.

As the recipient:

6. On the treat's page, under "Demo helpers", press "Open the recipient's page". It opens in a new tab, in the recipient's language, with the card, the dish, the shop and the code. It shows no price.
7. Write to the host, for example "I can't eat seafood." The dish changes within what is held. Write a thank-you and it appears on the sender's page.

As the shopkeeper:

8. Press "Play the shopkeeper" on the treat's page, or "At the counter" on the recipient's page. The shop's page opens with the code filled in.
9. Press "Serve this treat". This can take up to 20 seconds. The page says "Served", "PayPal paid $…" and "Confirmed with PayPal".
10. Go back to the sender's page: it shows what was charged and what was released. Open https://TODO-host/ledger for every treat with PayPal's order, hold, capture and payout ids.

Other things to try:

11. Nothing taken. Send a second treat, open the recipient's page and say you cannot make it, or press "Cancel and release the hold" on the sender's page. The hold is voided and the sender's page says "Nothing was taken".
12. The wrong shop and the second use. Enter a code at another shop's counter (the landing page links to every counter): it is refused. Enter a code that was already served: it is refused.
13. As an AI assistant: `claude mcp add --transport http have-you-eaten https://TODO-host/api/mcp`, then ask it to send something warm to someone in Kraków. It returns a PayPal link to approve with the sandbox buyer.

Notes. Treats are kept in memory: if the server has restarted, an old link no longer opens and a new treat has to be sent. A treat can be used for three days. A single treat holds at most $40.00. The demo allows 300 errand runs, 300 host runs and 300 PayPal orders a day; at the counter 200 settlements a day use the model, and after that the rules in code settle. Everything runs on the PayPal sandbox, and the shops and people are fictional.
