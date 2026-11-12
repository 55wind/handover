// End-to-end check of the whole flow, in-process, on the development stand-in for PayPal.
// Uses the real model when OPENAI_API_KEY and LLM_MODEL are set (E2E_SCRIPTED=1 forces the scripted stand-in).
// The real sandbox needs a person or a browser to approve each hold, so it is checked separately.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
process.env.PAYPAL_FAKE = '1';
const scriptedModel = process.env.E2E_SCRIPTED === '1' || !process.env.OPENAI_API_KEY || !process.env.LLM_MODEL;
if (scriptedModel) process.env.LLM_SCRIPTED = '1'; // so paths that pick the model themselves get the stand-in too

import type { Llm } from '../lib/agent';
import type { Treat } from '../lib/types';

async function main() {
  const { runErrand } = await import('../lib/errand');
  const { runHost } = await import('../lib/host');
  const { redeem, recheck } = await import('../lib/till');
  const { newTreat, startCheckout, placeHold, releaseTreat, swapTreat, setProposal, recipientView, ledger, servedAt } = await import('../lib/treats');
  const { store } = await import('../lib/store');
  const fake = await import('../lib/paypal-fake');
  const { backend } = await import('../lib/paypal');
  const { handleRpc } = await import('../lib/mcp');
  const llm: Llm | undefined = scriptedModel ? (await import('../lib/llm-scripted')).scripted() : undefined;
  console.log(`model: ${scriptedModel ? 'scripted stand-in' : process.env.LLM_MODEL}   paypal: development stand-in`);

  const WALLET = fake.WALLETS[0].id;
  const order = (t: Treat) => backend().getOrder(t.paypal.orderId!);
  const line = (label: string, text: string) => console.log(`  ${label.padEnd(40)} ${text}`);
  /** A model that makes these tool calls, one turn each, then stops. */
  const acting = (...turns: [name: string, args?: unknown][][]): Llm => async (messages) => {
    const turn = messages.filter((m) => m.role === 'assistant').length;
    const calls = turns[turn];
    if (!calls) return { content: 'Done.' };
    return { content: null, tool_calls: calls.map(([name, args], i) => ({ id: `t${turn}_${i}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args ?? {}) } })) };
  };

  /** A sender says one sentence, approves at PayPal, and the hold is placed. */
  async function send(sentence: string, name = 'Ji-woo'): Promise<Treat> {
    const t = newTreat({ name, language: 'en' });
    assert(typeof t !== 'string', String(t));
    assert.equal(await runErrand(t.id, sentence, llm), null);
    assert(t.shopId && t.itemId && t.card && t.price && t.ceiling, `the agent proposed a treat: ${t.errand.at(-1)?.text}`);
    const started = await startCheckout(t);
    assert(typeof started !== 'string', String(started));
    assert.equal(await placeHold(t.id), false, 'no hold before the sender approved');
    assert.equal(t.status, 'approving');
    fake.approve(t.paypal.orderId!, WALLET);
    assert.equal(await placeHold(t.id), true);
    assert.equal(t.status, 'held');
    assert.equal((await order(t)).authorizationStatus, 'CREATED');
    assert.equal(await runHost(t.id, { greet: true }, llm), null);
    assert.equal(t.host.length, 1, 'the host opens the conversation');
    return t;
  }

  // 1. One sentence becomes a treat near the recipient, with a card in her language. PayPal holds, takes nothing.
  const mom = await send('My mom in Haeundae, Busan has a cold. Get her something warm tonight.');
  if (scriptedModel) {
    assert.equal(mom.shopId, 'haeundae-juk');
    assert.equal(mom.itemId, 'abalone-juk');
    assert.equal(mom.price, '10.48');
    assert.equal(mom.ceiling, '14.00');
    assert.equal(mom.to!.language, 'ko');
    assert.match(mom.card!.forRecipient, /[가-힣]/, 'the card is in Korean');
  }
  assert.equal((await order(mom)).captureId, undefined);
  line('one sentence -> a treat in Busan', `${mom.itemId} at ${mom.shopId}, $${mom.price}, hold $${mom.ceiling}`);

  // 2. The recipient never sees an amount.
  const view = JSON.stringify(recipientView(mom));
  assert(!view.includes(mom.price!) && !view.includes(mom.ceiling!) && !/price|ceiling|paypal/i.test(view), 'no amounts and no PayPal ids on the recipient page');
  assert(!view.includes(mom.id), "the sender's id is not on the recipient page");

  // 3. She cannot eat seafood: the host changes the treat, within what is held.
  assert.equal(await runHost(mom.id, { text: "I can't eat seafood." }, llm), null);
  if (scriptedModel) {
    assert.equal(mom.itemId, 'vegetable-juk');
    assert.equal(mom.price, '6.74');
  }
  assert(Number(mom.price) <= Number(mom.ceiling));
  assert.equal(await runHost(mom.id, { text: 'Thank you, I will go tomorrow at lunch.' }, llm), null);
  if (scriptedModel) assert(mom.thanks, 'the thank-you was passed on');
  line('recipient changes it and says thanks', `now ${mom.itemId}, $${mom.price}`);

  // 4. The wrong shop cannot take it; the right shop takes exactly the price and the rest is released.
  assert.match(String(await redeem('gwangan-gukbap', mom.code, llm)), /for Haeundae Jukjip, not for this shop/);
  assert.equal(mom.status, 'held');
  const served = await redeem(mom.shopId!, mom.code, llm);
  assert(typeof served !== 'string', String(served));
  assert.equal(mom.status, 'enjoyed');
  assert.equal(served.served.charged, mom.price);
  assert.equal(served.served.verified, true);
  const paid = await order(mom);
  assert.equal(paid.capturedAmount, mom.price, 'PayPal took the price of the dish, not the hold');
  assert.equal(paid.authorizationStatus, 'CAPTURED');
  assert.equal(mom.outcome!.released, (Number(mom.ceiling) - Number(mom.price)).toFixed(2));
  assert.deepEqual(fake.payouts.at(-1), { email: 'shops@example.test', amount: mom.price, reference: `treat-${mom.ref}` });
  assert.match(String(await redeem(mom.shopId!, mom.code, llm)), /already been served/);
  assert.equal(fake.payouts.filter((p) => p.reference === `treat-${mom.ref}`).length, 1, 'the shop is paid once');
  line('served at the counter', `took $${mom.outcome!.charged}, released $${mom.outcome!.released}, shop paid $${fake.payouts.at(-1)!.amount}`);

  // 5. The recipient says no: the hold is released and nothing is taken.
  const sister = await send('My sister in Yaba, Lagos has an exam week. Send her a coffee.', 'Tunde');
  assert.equal(await runHost(sister.id, { text: "No thanks, I can't make it this week." }, llm), null);
  if (scriptedModel) {
    assert.equal(sister.status, 'released');
    assert.equal((await order(sister)).authorizationStatus, 'VOIDED');
    assert.equal((await order(sister)).captureId, undefined);
    assert.match(String(await redeem(sister.shopId!, sister.code, llm)), /no longer available/);
  }
  line('recipient declines', `${sister.status}, nothing taken`);

  // 6. The sender cancels before it is used.
  const friend = await send('My friend in Roma Norte, Mexico City has a birthday today.', 'Sofía');
  assert.equal(await releaseTreat(friend, 'You cancelled the treat.', 'sender'), null);
  assert.equal(friend.status, 'released');
  assert.equal((await order(friend)).authorizationStatus, 'VOIDED');

  // 7. Three days pass: the treat runs out at the counter and the hold is released.
  const late = await send('My dad in Kazimierz, Kraków has a cold.');
  late.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.match(String(await redeem(late.shopId!, late.code, llm)), /run out/);
  assert.equal(late.status, 'released');
  assert.equal((await order(late)).authorizationStatus, 'VOIDED');
  line('cancelled / run out', 'both released, nothing taken');

  // 8. A change that costs more than was set aside, or in another city, is refused.
  const tight = await send('My mom in Haeundae, Busan has a cold.');
  assert.match(String(swapTreat(tight, 'dalmaji-bakery', 'whole-cake')), /more than was set aside/);
  assert.match(String(swapTreat(tight, 'fonda-lupita', 'caldo-pollo')), /not to another city/);
  assert.match(String(setProposal(tight, { shopId: 'haeundae-juk', itemId: 'abalone-juk', toName: 'Mom', toPlace: 'Busan', cardForRecipient: 'x', cardForSender: 'x' })), /already started/);

  // 9. A till model that misbehaves: pays the shop first, never takes the payment, then claims it served.
  const rogue = acting([['pay_shop']], [['finish', { result: 'served', for_shop: 'Paid. Serve it.', for_sender: 'She is eating now.' }]]);
  const before = fake.payouts.length;
  const refusedRun = await redeem(tight.shopId!, tight.code, rogue);
  assert(typeof refusedRun === 'string', 'nothing is served on the word of a model');
  assert.equal(tight.status, 'held', 'the treat is still good');
  assert.equal((await order(tight)).captureId, undefined);
  assert.equal(fake.payouts.length, before, 'no shop is paid before the payment was taken');
  assert(tight.events.some((e) => e.type === 'refused'));

  // 10. PayPal fails while taking the payment: nothing is served, the treat stays good, and a second try works.
  fake.failNext('captureAuthorization', 'INTERNAL_SERVICE_ERROR: try again later.');
  assert.match(String(await redeem(tight.shopId!, tight.code, acting([['take_payment']]))), /still good/);
  assert.equal(tight.status, 'held');
  // 11. PayPal takes the payment but its answer is lost: the closing check finds the capture and pays the shop once.
  fake.loseNextAnswer('captureAuthorization', 'socket hang up');
  const lost = await redeem(tight.shopId!, tight.code, llm);
  assert(typeof lost !== 'string', String(lost));
  assert.equal(tight.status, 'enjoyed');
  assert.equal(tight.paypal.captureId, (await order(tight)).captureId);
  assert.equal(fake.payouts.filter((p) => p.reference === `treat-${tight.ref}`).length, 1);
  line('misbehaving model / PayPal errors', 'nothing served on a claim; lost answer recovered');

  // 12. The shop cannot be paid right now: the recipient still eats, and the money is recorded as owed.
  const owed = await send('My mom in Maginhawa, Manila has a cold.');
  fake.failNext('payout', 'INSUFFICIENT_FUNDS');
  const stillServed = await redeem(owed.shopId!, owed.code, llm);
  assert(typeof stillServed !== 'string', String(stillServed));
  assert.equal(owed.status, 'enjoyed');
  assert.equal(owed.paypal.payoutStatus, 'OWED');

  // 13. No model available: the rules settle it.
  const byRules = await send('My mom in Haeundae, Busan has a cold.');
  const ruled = await redeem(byRules.shopId!, byRules.code, null);
  assert(typeof ruled !== 'string', String(ruled));
  assert.equal(byRules.outcome!.verified, true);
  assert(!byRules.events.some((e) => e.actor === 'till'), 'no model took part');

  // 14. PayPal cannot be read back after the payment: served, shown as unconfirmed, confirmed on a later look.
  const unsure = await send('My mom in Haeundae, Busan has a cold.');
  const readOrder = fake.fakeBackend.getOrder;
  fake.fakeBackend.getOrder = async (id) => {
    const o = await readOrder(id);
    if (o.captureId) throw new Error('PayPal did not answer within 20 seconds.');
    return o;
  };
  const shaky = await redeem(unsure.shopId!, unsure.code, llm);
  fake.fakeBackend.getOrder = readOrder;
  assert(typeof shaky !== 'string', String(shaky));
  assert.equal(shaky.served.verified, false);
  await recheck(unsure, 0);
  assert.equal(unsure.outcome!.verified, true);
  line('payout owed / rules only / unconfirmed', 'all served; confirmation follows PayPal');

  // 15. An AI assistant sends a treat over MCP.
  let rpcId = 0;
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = (await handleRpc({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } })) as { result: { content: { text: string }[]; isError?: boolean } };
    assert(!r.result.isError, r.result.content[0].text);
    return JSON.parse(r.result.content[0].text);
  };
  const found = await tool('find_treats', { place: 'Kazimierz, Kraków' });
  assert.equal(found.city, 'Kraków');
  const sent = await tool('send_treat', { shop_id: 'piekarnia-rogal', item_id: 'sernik', recipient_name: 'Tata', recipient_place: 'Kraków', card_for_recipient: 'Wszystkiego najlepszego, Tato.', card_for_sender: 'Happy birthday, Dad.', sender_name: 'Ola' });
  assert.equal((await tool('treat_status', { treat_id: sent.treat_id })).status, 'approving');
  const viaAgent = store.treats.get(sent.treat_id)!;
  fake.approve(viaAgent.paypal.orderId!, WALLET);
  const ready = await tool('treat_status', { treat_id: sent.treat_id });
  assert.equal(ready.status, 'held');
  assert.match(ready.link_for_the_recipient, new RegExp(`/t/${viaAgent.code}$`));
  while (viaAgent.running) await new Promise((r) => setTimeout(r, 10)); // the host is writing its greeting
  const cake = await redeem('piekarnia-rogal', viaAgent.code, llm);
  assert(typeof cake !== 'string', String(cake));
  const done = await tool('treat_status', { treat_id: sent.treat_id });
  assert.equal(done.status, 'enjoyed');
  assert.equal(done.confirmed_with_paypal, true);
  line('AI assistant over MCP', `sernik in Kraków: held $${done.held_usd}, charged $${done.charged_usd}`);

  // 16. Guessing codes at a counter is cut off.
  for (let i = 0; i < 8; i++) assert.match(String(await redeem('pod-lipa', `WRONG${i}XX`, llm)), /no treat with that code/);
  assert.match(String(await redeem('pod-lipa', 'WRONG9XX', llm)), /Too many wrong codes/);

  // The books: PayPal and the ledger agree, nothing is held that should not be, and the ledger gives nothing away.
  const { rows, totals } = ledger();
  for (const t of store.treats.values()) {
    if (!t.paypal.orderId || t.status === 'approving') continue;
    const o = await order(t);
    assert.equal(!!o.captureId, t.status === 'enjoyed', `${t.ref}: the ledger and PayPal disagree`);
    assert.equal(o.authorizationStatus === 'CREATED', t.status === 'held', `${t.ref}: an open hold must be a treat that can still be used`);
    if (o.captureId) assert(Number(o.capturedAmount) <= Number(o.amount), `${t.ref}: more was taken than was held`);
  }
  const text = JSON.stringify(rows);
  for (const t of store.treats.values()) assert(!text.includes(t.id) && !text.includes(t.code), 'the ledger shows references, never an id or a code');
  assert.equal(servedAt('haeundae-juk').length, rows.filter((r) => r.shopId === 'haeundae-juk' && r.status === 'enjoyed').length);
  console.log(`  ledger: ${totals.treats} treats, ${totals.enjoyed} enjoyed, charged $${totals.charged}, released $${totals.released}, still held $${totals.held}`);
  console.log('E2E PASSED');
}

main().catch((e) => {
  console.error('E2E FAILED');
  console.error(e);
  process.exit(1);
});
