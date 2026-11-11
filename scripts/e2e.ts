// End-to-end check of the whole flow, in-process, on the development stand-in for PayPal.
// Uses the real model when OPENAI_API_KEY and LLM_MODEL are set (E2E_SCRIPTED=1 forces the scripted stand-in).
// The real sandbox needs a person or a browser to approve each payment, so it is checked separately.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
process.env.PAYPAL_FAKE = '1';
const scriptedModel = process.env.E2E_SCRIPTED === '1' || !process.env.OPENAI_API_KEY || !process.env.LLM_MODEL;
if (scriptedModel) process.env.LLM_SCRIPTED = '1'; // so paths that pick the model themselves get the stand-in too

import type { Llm } from '../lib/agent';
import type { Purchase } from '../lib/types';

async function main() {
  const { runSettlement, settleWhenApproved, recheck } = await import('../lib/agent');
  const { runClerk } = await import('../lib/clerk');
  const { makeQuote, openPurchase, startCheckout, refundSale, sales, poolAvailableCents, grantsThisMonth } = await import('../lib/shop');
  const { store } = await import('../lib/store');
  const { POOL_SEED } = await import('../lib/seller');
  const fake = await import('../lib/paypal-fake');
  const { backend } = await import('../lib/paypal');
  const { handleRpc } = await import('../lib/mcp');
  const llm: Llm | undefined = scriptedModel ? (await import('../lib/llm-scripted')).scripted() : undefined;
  console.log(`model: ${scriptedModel ? 'scripted stand-in' : process.env.LLM_MODEL}   paypal: development stand-in`);

  const wallet = (country: string, n = 0) => fake.WALLETS.filter((w) => w.country === country)[n]?.id ?? assert.fail(`no demo wallet in ${country}`);
  const pool = () => store.pool.balance;
  const order = (p: Purchase) => backend().getOrder(p.paypal.orderId!);

  interface Buy {
    product?: string;
    claim: string;
    walletId: string;
    gift?: string;
    say?: string;
    document?: string;
    model?: Llm | null;
  }
  /** Quote, open, talk to the clerk, start the payment and approve it as a wallet. */
  async function approved(o: Buy): Promise<Purchase> {
    const quote = makeQuote(o.product ?? 'lettering', o.claim);
    assert(typeof quote !== 'string', String(quote));
    const p = openPurchase({ quoteId: quote.id, gift: o.gift });
    assert(typeof p !== 'string', String(p));
    assert.equal(await runClerk(p.id, { greet: true }, llm), null);
    assert.equal(p.messages.length, 1, 'the clerk opens the conversation');
    if (o.say) assert.equal(await runClerk(p.id, { text: o.say, documentDataUrl: o.document }, llm), null);
    const started = await startCheckout(p);
    assert(typeof started !== 'string', String(started));
    fake.approve(p.paypal.orderId!, o.walletId);
    return p;
  }
  /** The same, then the agent settles it. */
  async function buy(o: Buy): Promise<Purchase> {
    const p = await approved(o);
    await runSettlement(p.id, o.model === undefined ? llm : o.model);
    assert.equal(p.running, false);
    assert(p.outcome, 'every settlement ends with an outcome');
    return p;
  }
  const line = (label: string, p: Purchase) =>
    console.log(`  ${label.padEnd(36)} quoted ${p.quote.price.country} $${p.quote.price.fair.padStart(5)}  wallet ${p.paypal.walletCountry}  -> ${p.status}${p.outcome?.verified ? ', confirmed' : ''}  paid $${p.status === 'captured' ? p.amount : '0.00'}`);
  /** A model that makes these tool calls, one turn each, then stops. */
  const acting = (...turns: [name: string, args?: unknown][][]): Llm => async (messages) => {
    const turn = messages.filter((m) => m.role === 'assistant').length;
    const calls = turns[turn];
    if (!calls) return { content: 'Done.' };
    return { content: null, tool_calls: calls.map(([name, args], i) => ({ id: `t${turn}_${i}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args ?? {}) } })) };
  };

  // The seller opened the pool; everything after that comes from buyers.
  assert.equal(pool(), POOL_SEED);
  assert.equal(store.pool.entries[0]?.kind, 'seed');

  // 1. A buyer in Viet Nam pays the Viet Nam price with a wallet registered in Viet Nam.
  const linh = await buy({ claim: 'VN', walletId: wallet('VN') });
  line('Viet Nam price, Viet Nam wallet', linh);
  assert.equal(linh.quote.price.fair, '10.41');
  assert.equal(linh.status, 'captured');
  assert.equal(linh.outcome!.verified, true);
  assert.equal((await order(linh)).captureStatus, 'COMPLETED');

  // 2. Someone asks for the Viet Nam price and pays with a wallet registered in Germany: nothing is taken.
  const cheat = await buy({ claim: 'VN', walletId: wallet('DE') });
  line('Viet Nam price, Germany wallet', cheat);
  assert.equal(cheat.status, 'voided');
  assert.equal(cheat.paypal.captureId, undefined);
  assert.equal((await order(cheat)).captureId, undefined, 'no capture exists at PayPal');
  assert.equal((await order(cheat)).authorizationId, undefined, 'no hold was even placed');
  assert.equal(cheat.outcome!.offer?.price.country, 'DE');
  assert.equal(cheat.outcome!.offer?.price.fair, '36.23');

  // 3. The same wallet cannot buy the same product twice.
  const again = await buy({ claim: 'VN', walletId: wallet('VN') });
  line('Same wallet, second time', again);
  assert.equal(again.status, 'voided');
  assert.equal((await order(again)).authorizationStatus, 'VOIDED', 'the hold was released');

  // 3b. Nor twice at the same moment: two purchases from one wallet settling together end with one payment.
  const twins = await Promise.all([approved({ product: 'brushes', claim: 'JP', walletId: wallet('JP') }), approved({ product: 'brushes', claim: 'JP', walletId: wallet('JP') })]);
  await Promise.all(twins.map((p) => runSettlement(p.id, llm)));
  assert.deepEqual(twins.map((p) => p.status).sort(), ['captured', 'voided'], 'exactly one of two simultaneous purchases is taken');
  for (const p of twins) if (p.status === 'voided') assert.equal((await order(p)).captureId, undefined);
  console.log('  two at once from one wallet            one taken, one released');

  // 4. A buyer in Norway pays the list price and covers part of someone else's.
  const ingrid = await buy({ claim: 'NO', walletId: wallet('NO'), gift: '5.00' });
  line('Norway, with a $5 gift', ingrid);
  assert.equal(ingrid.quote.price.fair, '44.00');
  assert.equal(ingrid.amount, '49.00');
  assert.equal(ingrid.status, 'captured');
  assert.equal(pool(), '25.00');

  // 5. A student whose wallet is in Germany tells the clerk; the clerk helps from the pool, inside the limits.
  const before = pool();
  const student = await buy({ claim: 'DE', walletId: wallet('DE'), say: 'I am a student from Nepal studying in Berlin on a small scholarship. Can you help?' });
  line('Germany wallet, student from Nepal', student);
  assert(student.help, 'the clerk gave help');
  assert(Number(student.help!.amount) <= 8.8, 'help stays within the 20% cap for a word alone');
  assert.equal(student.status, 'captured');
  assert.equal(Number(pool()), Number(before) - Number(student.help!.amount));
  assert.equal(grantsThisMonth(), 1);
  assert(student.messages.some((m) => m.from === 'clerk'));

  // 6. With the pool empty the clerk cannot give more, whatever is asked.
  const kept = pool();
  store.pool.balance = '0.00';
  const quote6 = makeQuote('lettering', 'DE');
  assert(typeof quote6 !== 'string');
  const p6 = openPurchase({ quoteId: quote6.id });
  assert(typeof p6 !== 'string');
  await runClerk(p6.id, { text: 'I lost my job. Can you help?' }, llm);
  assert.equal(p6.help, undefined, 'no help from an empty pool');
  assert.equal(p6.amount, quote6.price.fair);
  console.log('  empty pool                             the clerk gave nothing');

  // 6b. The clerk does not bargain, and records a gift when asked.
  store.pool.balance = kept;
  await runClerk(p6.id, { text: 'Can you do it cheaper?' }, llm);
  assert.equal(p6.help, undefined, 'asking for a lower price is not a reason');
  await runClerk(p6.id, { text: 'I would like to cover an hour for someone.' }, llm);
  if (scriptedModel) assert.equal(p6.gift, '5.00');
  console.log(`  no bargaining, gift on request         gift $${p6.gift}, pays $${p6.amount}`);

  // 6c. A document that supports the buyer's word raises what the clerk may give.
  store.pool.balance = '40.00';
  const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const onWord = await buy({ product: 'brushes', claim: 'GB', walletId: wallet('NG'), say: 'I am a refugee and cannot afford this.' });
  const withDoc = await buy({ claim: 'FR', walletId: wallet('NP'), say: 'I am a student, here is my card.', document: PIXEL });
  if (scriptedModel) {
    assert.equal(onWord.help?.amount, '2.40', '20% of the $12.00 list price on a word');
    assert.equal(withDoc.evidence?.supports, true);
    assert.equal(withDoc.help?.amount, '22.00', '50% of the $44.00 list price with a document');
  }
  console.log(`  help on a word / with a document       $${onWord.help?.amount} / $${withDoc.help?.amount}`);
  assert.equal(pool(), '40.00', 'help promised to payments that were released never left the pool');

  // 6d. A promise of help lapses with its purchase, and so does the price.
  const stale = openPurchase({ quoteId: (makeQuote('lettering', 'DE') as { id: string }).id });
  assert(typeof stale !== 'string');
  stale.help = { amount: '8.00', reason: 'test' };
  assert.equal(poolAvailableCents(), 3200, 'a live promise is set aside');
  stale.createdAt = new Date(Date.now() - 61 * 60_000).toISOString();
  assert.equal(poolAvailableCents(), 4000, 'after an hour it no longer holds the pool');
  assert.equal(await startCheckout(stale), 'This price has expired. Please ask for it again.');
  store.purchases.delete(stale.id);

  // 6e. Help that the pool can no longer cover is not taken out of thin air: the payment is released.
  const promised = await approved({ claim: 'DE', walletId: wallet('DE', 0), product: 'brushes', say: 'I am a student on a small scholarship. Can you help?' });
  assert(promised.help, 'the clerk promised help');
  store.pool.balance = '0.00';
  await runSettlement(promised.id, llm);
  assert.equal(promised.status, 'voided');
  assert.equal(pool(), '0.00', 'the pool never goes below zero');
  assert.equal((await order(promised)).captureId, undefined);
  console.log('  promised help, pool since emptied      released, nothing taken');

  // 7. A model that misbehaves: it tries to take a payment the rules do not allow, then walks away.
  const robbed = await buy({ claim: 'IN', walletId: wallet('US'), model: acting([['hold_payment'], ['take_payment'], ['take_payment']]) });
  line('Misbehaving model, India price', robbed);
  assert.equal(robbed.status, 'voided');
  assert.equal(robbed.paypal.captureId, undefined);
  assert.equal((await order(robbed)).captureId, undefined, 'nothing was captured at PayPal');
  assert(robbed.events.filter((e) => e.type === 'refused').length >= 2, 'the rules refused the calls');

  // 7b. A model that stops after the hold: code releases what it left open and takes nothing.
  const left = await buy({ claim: 'BR', walletId: wallet('BR'), model: acting([['hold_payment']]) });
  line('Model stops after the hold', left);
  assert.equal(left.status, 'voided');
  assert.equal((await order(left)).authorizationStatus, 'VOIDED');

  // 7c. A model that releases and then places a new hold: the hold is refused, and nothing is left open at PayPal.
  const reheld = await buy({ claim: 'NG', walletId: wallet('NG'), model: acting([['release_payment']], [['hold_payment']], [['take_payment']]) });
  line('Hold after release', reheld);
  assert.equal(reheld.status, 'voided');
  assert.equal(reheld.outcome!.verified, true);
  assert.equal((await order(reheld)).authorizationId, undefined, 'no hold was placed after the release');
  assert.equal((await order(reheld)).captureId, undefined);

  // 7d. A model that says "paid" when nothing was taken: the buyer is told what PayPal shows, not what the model said.
  const lied = await buy({ claim: 'VN', walletId: wallet('US'), model: acting([['release_payment']], [['finish', { result: 'paid', message: 'Paid. Enjoy the course!' }]]) });
  assert.equal(lied.status, 'voided');
  assert(!/Enjoy/.test(lied.outcome!.text) && /Nothing was taken/.test(lied.outcome!.text), 'a false closing message is replaced');
  console.log(`  model claims "paid" after a release    buyer is told: ${lied.outcome!.text.slice(0, 60)}...`);

  // 8. PayPal fails in the middle of taking a payment: nothing is shown as paid.
  fake.failNext('captureAuthorization', 'INTERNAL_SERVICE_ERROR: try again later.');
  const failed = await buy({ claim: 'NP', walletId: wallet('NP') });
  line('PayPal error during capture', failed);
  assert.equal(failed.status, 'voided');
  assert.equal(failed.paypal.captureId, undefined);
  assert.equal((await order(failed)).authorizationStatus, 'VOIDED');

  // 8b. PayPal takes the payment but its answer is lost: the purchase is recorded as paid, not as released.
  store.pool.balance = '10.00';
  fake.loseNextAnswer('captureAuthorization', 'socket hang up');
  const lost = await buy({ claim: 'US', walletId: wallet('US'), gift: '2.00' });
  line('Capture answer lost', lost);
  assert.equal(lost.status, 'captured');
  assert.equal(lost.outcome!.captured, true);
  assert.equal(lost.outcome!.verified, true);
  assert.equal(lost.paypal.captureId, (await order(lost)).captureId);
  assert(/^Paid/.test(lost.outcome!.text), 'the buyer is told it was paid');
  assert.equal(pool(), '12.00', 'the gift entered the pool exactly once');
  assert.equal(store.pool.entries.filter((e) => e.ref === lost.ref).length, 1);

  // 8c. PayPal answers a capture with a status that is not a payment: it is not recorded as one.
  const real = fake.fakeBackend.captureAuthorization;
  fake.fakeBackend.captureAuthorization = async () => ({ captureId: 'DECLINEDCAPTURE0001', status: 'DECLINED' });
  const declined = await buy({ product: 'brushes', claim: 'BR', walletId: wallet('BR') });
  fake.fakeBackend.captureAuthorization = real;
  line('Capture declined by PayPal', declined);
  assert.equal(declined.status, 'voided');
  assert.equal(declined.paypal.captureId, undefined);
  assert.equal((await order(declined)).authorizationStatus, 'VOIDED');

  // 8d. PayPal cannot be reached for the closing check: the result is shown as unconfirmed, and confirmed on a later look.
  const readOrder = fake.fakeBackend.getOrder;
  fake.fakeBackend.getOrder = async (id) => {
    const o = await readOrder(id);
    if (o.captureId) throw new Error('PayPal did not answer within 20 seconds.');
    return o;
  };
  const unsure = await buy({ product: 'brushes', claim: 'NG', walletId: wallet('NG') });
  assert.equal(unsure.status, 'captured');
  assert.equal(unsure.outcome!.verified, false, 'not called confirmed while PayPal cannot be read');
  await recheck(unsure.id, 0);
  assert.equal(unsure.outcome!.verified, false, 'still unconfirmed while PayPal is down');
  fake.fakeBackend.getOrder = readOrder;
  await recheck(unsure.id);
  assert.equal(unsure.outcome!.verified, false, 'PayPal is asked again at most once a minute');
  await recheck(unsure.id, 0);
  assert.equal(unsure.outcome!.verified, true);
  assert(/^Paid/.test(unsure.outcome!.text));
  assert.equal(unsure.running, false);
  console.log('  PayPal unreachable for the check       shown as unconfirmed, confirmed on a later look');

  // 9. An AI shopping agent over MCP asks for the Viet Nam price; the wallet that pays is in the United States.
  let rpcId = 0;
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = (await handleRpc({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } })) as { result: { content: { text: string }[]; isError?: boolean } };
    assert(!r.result.isError, r.result.content[0].text);
    return JSON.parse(r.result.content[0].text);
  };
  const price = await tool('get_price', { product_id: 'brushes', country: 'VN' });
  const checkout = await tool('start_checkout', { quote_id: price.quote_id });
  const viaAgent = store.purchases.get(checkout.purchase_id)!;

  // 9b. Opening the return address before the buyer approved settles nothing and spoils nothing.
  await settleWhenApproved(viaAgent.id);
  assert.equal(viaAgent.status, 'approving', 'an unapproved purchase is left as it is');
  assert.equal(viaAgent.outcome, undefined);

  fake.approve(viaAgent.paypal.orderId!, wallet('US'));
  await settleWhenApproved(viaAgent.id);
  const seen = await tool('get_purchase', { purchase_id: checkout.purchase_id });
  line('AI agent over MCP, US wallet', viaAgent);
  assert.equal(seen.status, 'voided');
  assert.equal(seen.price_for_the_wallets_country.country, 'US');
  assert.equal(seen.viaAgent, true);

  // 9c. With the day's model allowance for settlements spent, the rules settle an approved payment without a model.
  process.env.DAILY_SETTLE_LIMIT = '0';
  const byRules = await approved({ product: 'brushes', claim: 'NO', walletId: wallet('NO') });
  await settleWhenApproved(byRules.id);
  line('No model allowance left', byRules);
  assert.equal(byRules.status, 'captured');
  assert.equal(byRules.outcome!.verified, true);
  assert(!byRules.events.some((e) => e.actor === 'agent'), 'no model took part');
  const byRulesWrong = await approved({ product: 'brushes', claim: 'VN', walletId: wallet('DE') });
  await settleWhenApproved(byRulesWrong.id);
  assert.equal(byRulesWrong.status, 'voided');
  assert.equal(byRulesWrong.outcome!.offer?.price.country, 'DE');
  delete process.env.DAILY_SETTLE_LIMIT;

  // 10. The seller refunds a sale. The buyer gets back what they paid for the product; the gift stays in the pool.
  const poolBefore = pool();
  const refunded = await refundSale(ingrid.ref);
  assert(typeof refunded !== 'string', String(refunded));
  assert.equal(refunded.status, 'refunded');
  assert.equal(fake.refundedAmount(ingrid.paypal.captureId!), '44.00', 'the $5 gift is not sent back');
  assert.equal(pool(), poolBefore, 'a refund does not take a gift out of the pool');
  assert.equal(await refundSale(ingrid.ref), 'Only a captured payment can be refunded.');
  assert.equal(await refundSale(ingrid.id), 'This sale is no longer on file.', "the buyer's own id does not work at the seller's desk");

  // 10b. Refunding a sale the pool helped with returns that help to the pool, and is not counted as a new grant.
  const grants = grantsThisMonth();
  const helped = await refundSale(student.ref);
  assert(typeof helped !== 'string', String(helped));
  assert.equal(fake.refundedAmount(student.paypal.captureId!), student.amount);
  assert.equal(Number(pool()), Number(poolBefore) + Number(student.help!.amount));
  assert.equal(grantsThisMonth(), grants);
  console.log(`  refunds                                $44.00 back, gift kept; help of $${student.help!.amount} returned to the pool`);

  // The ledger never shows the id that opens a buyer's page.
  for (const s of sales()) assert(!store.purchases.has(s.id), 'a ledger row carries a reference, not a purchase id');
  for (const e of store.pool.entries) assert(!store.purchases.has(e.ref));
  // Nothing above took money from a wallet outside the quoted country.
  for (const s of sales()) if (s.status === 'captured' || s.status === 'refunded') assert.equal(s.walletCountry, s.quotedCountry, `${s.id} was captured across countries`);
  // Nothing is left held at PayPal.
  for (const p of store.purchases.values()) {
    if (!p.paypal.orderId || p.status === 'approving' || p.status === 'open') continue;
    const o = await order(p);
    assert(!o.authorizationId || o.authorizationStatus === 'VOIDED' || o.authorizationStatus === 'CAPTURED', `${p.ref} still has an open hold`);
    assert.equal(!!o.captureId, p.status === 'captured' || p.status === 'refunded', `${p.ref}: the ledger and PayPal disagree`);
  }
  console.log(`  ledger: ${sales().length} sales, ${sales().filter((s) => s.status === 'captured').length} captured, ${sales().filter((s) => s.status === 'voided').length} released, pool $${pool()}`);
  console.log('E2E PASSED');
}

main().catch((e) => {
  console.error('E2E FAILED');
  console.error(e);
  process.exit(1);
});
