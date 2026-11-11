// End-to-end check of the whole flow, in-process, on the development stand-in for PayPal.
// Uses the real model when OPENAI_API_KEY and LLM_MODEL are set (E2E_SCRIPTED=1 forces the scripted stand-in).
// The real sandbox needs a person or a browser to approve each payment, so it is checked separately.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
process.env.PAYPAL_FAKE = '1';
const scriptedModel = process.env.E2E_SCRIPTED === '1' || !process.env.OPENAI_API_KEY || !process.env.LLM_MODEL;

import type { Llm } from '../lib/agent';
import type { Purchase } from '../lib/types';

async function main() {
  const { runSettlement } = await import('../lib/agent');
  const { runClerk } = await import('../lib/clerk');
  const { makeQuote, openPurchase, startCheckout, refundSale, sales } = await import('../lib/shop');
  const { store } = await import('../lib/store');
  const fake = await import('../lib/paypal-fake');
  const { backend } = await import('../lib/paypal');
  const { handleRpc } = await import('../lib/mcp');
  const llm: Llm | undefined = scriptedModel ? (await import('../lib/llm-scripted')).scripted() : undefined;
  console.log(`model: ${scriptedModel ? 'scripted stand-in' : process.env.LLM_MODEL}   paypal: development stand-in`);

  const wallet = (country: string, n = 0) => fake.WALLETS.filter((w) => w.country === country)[n]?.id ?? assert.fail(`no demo wallet in ${country}`);

  /** Quote, open, start the payment, approve it as a wallet, then let the agent settle it. */
  async function buy(o: { product?: string; claim: string; walletId: string; gift?: string; say?: string; document?: string; model?: Llm }): Promise<Purchase> {
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
    await runSettlement(p.id, o.model ?? llm);
    assert.equal(p.running, false);
    assert(p.outcome, 'every settlement ends with an outcome');
    return p;
  }
  const line = (label: string, p: Purchase) =>
    console.log(`  ${label.padEnd(34)} quoted ${p.quote.price.country} $${p.quote.price.fair.padStart(5)}  wallet ${p.paypal.walletCountry}  -> ${p.status}${p.outcome?.verified ? ', confirmed' : ''}  paid $${p.status === 'captured' ? p.amount : '0.00'}`);

  // 1. A buyer in Viet Nam pays the Viet Nam price with a wallet registered in Viet Nam.
  const linh = await buy({ claim: 'VN', walletId: wallet('VN') });
  line('Viet Nam price, Viet Nam wallet', linh);
  assert.equal(linh.quote.price.fair, '10.41');
  assert.equal(linh.status, 'captured');
  assert.equal(linh.outcome!.verified, true);
  assert.equal((await backend().getOrder(linh.paypal.orderId!)).captureStatus, 'COMPLETED');

  // 2. Someone asks for the Viet Nam price and pays with a wallet registered in Germany: nothing is taken.
  const cheat = await buy({ claim: 'VN', walletId: wallet('DE') });
  line('Viet Nam price, Germany wallet', cheat);
  assert.equal(cheat.status, 'voided');
  assert.equal(cheat.paypal.captureId, undefined);
  const order = await backend().getOrder(cheat.paypal.orderId!);
  assert.equal(order.captureId, undefined, 'no capture exists at PayPal');
  assert.equal(order.authorizationId, undefined, 'no hold was even placed');
  assert.equal(cheat.outcome!.offer?.price.country, 'DE');
  assert.equal(cheat.outcome!.offer?.price.fair, '36.23');

  // 3. The same wallet cannot buy the same product twice.
  const again = await buy({ claim: 'VN', walletId: wallet('VN') });
  line('Same wallet, second time', again);
  assert.equal(again.status, 'voided');
  assert.equal((await backend().getOrder(again.paypal.orderId!)).authorizationStatus, 'VOIDED', 'the hold was released');

  // 4. A buyer in Norway pays the list price and covers part of someone else's.
  const ingrid = await buy({ claim: 'NO', walletId: wallet('NO'), gift: '5.00' });
  line('Norway, with a $5 gift', ingrid);
  assert.equal(ingrid.quote.price.fair, '44.00');
  assert.equal(ingrid.amount, '49.00');
  assert.equal(ingrid.status, 'captured');
  assert.equal(store.pool.balance, '5.00');

  // 5. A student whose wallet is in Germany tells the clerk; the clerk helps from the pool, inside the limits.
  const before = store.pool.balance;
  const student = await buy({ claim: 'DE', walletId: wallet('DE'), say: 'I am a student from Nepal studying in Berlin on a small scholarship. Can you help?' });
  line('Germany wallet, student from Nepal', student);
  assert(student.help, 'the clerk gave help');
  assert(Number(student.help!.amount) <= 5 && Number(student.help!.amount) <= 8.8, 'help stays within the pool and the 20% cap');
  assert.equal(student.status, 'captured');
  assert.equal(Number(store.pool.balance), Number(before) - Number(student.help!.amount));
  assert(student.messages.some((m) => m.from === 'clerk'));

  // 6. With the pool empty the clerk cannot give more, whatever is asked.
  const quote6 = makeQuote('lettering', 'DE');
  assert(typeof quote6 !== 'string');
  const p6 = openPurchase({ quoteId: quote6.id });
  assert(typeof p6 !== 'string');
  if (Number(store.pool.balance) === 0) {
    await runClerk(p6.id, { text: 'I lost my job. Can you help?' }, llm);
    assert.equal(p6.help, undefined, 'no help from an empty pool');
    assert.equal(p6.amount, quote6.price.fair);
    console.log('  empty pool                         the clerk gave nothing');
  }

  // 6b. The clerk does not bargain, and records a gift when asked.
  await runClerk(p6.id, { text: 'Can you do it cheaper?' }, llm);
  assert.equal(p6.help, undefined, 'asking for a lower price is not a reason');
  await runClerk(p6.id, { text: 'I would like to cover an hour for someone.' }, llm);
  if (scriptedModel) assert.equal(p6.gift, '5.00');
  console.log(`  no bargaining, gift on request        gift $${p6.gift}, pays $${p6.amount}`);

  // 6c. With money in the pool, a document that supports the buyer's word raises what the clerk may give.
  store.pool.balance = '40.00';
  const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const onWord = await buy({ product: 'brushes', claim: 'GB', walletId: wallet('NG'), say: 'I am a refugee and cannot afford this.' });
  const withDoc = await buy({ claim: 'FR', walletId: wallet('NP'), say: 'I am a student, here is my card.', document: PIXEL });
  if (scriptedModel) {
    assert.equal(onWord.help?.amount, '2.40', '20% of the $12.00 list price on a word');
    assert.equal(withDoc.evidence?.supports, true);
    assert.equal(withDoc.help?.amount, '22.00', '50% of the $44.00 list price with a document');
  }
  console.log(`  help on a word / with a document      $${onWord.help?.amount} / $${withDoc.help?.amount}`);
  store.pool.balance = '0.00';

  // 7. A model that misbehaves: it tries to take a payment the rules do not allow, then walks away.
  const rogue: Llm = async (messages) => {
    const turn = messages.filter((m) => m.role === 'assistant').length;
    const call = (name: string) => ({ id: `rogue_${turn}_${name}`, type: 'function' as const, function: { name, arguments: '{}' } });
    if (turn === 0) return { content: 'Taking the money straight away.', tool_calls: [call('hold_payment'), call('take_payment'), call('take_payment')] };
    return { content: 'Done.' }; // never releases, never finishes
  };
  const robbed = await buy({ claim: 'IN', walletId: wallet('US'), model: rogue });
  line('Misbehaving model, India price', robbed);
  assert.equal(robbed.status, 'voided');
  assert.equal(robbed.paypal.captureId, undefined);
  assert((await backend().getOrder(robbed.paypal.orderId!)).captureId === undefined, 'nothing was captured at PayPal');
  assert(robbed.events.filter((e) => e.type === 'refused').length >= 2, 'the rules refused the calls');
  // The same model on a matching wallet stops after the hold: code releases what it left open and takes nothing.
  const lazy: Llm = async (messages) => {
    const turn = messages.filter((m) => m.role === 'assistant').length;
    return turn === 0 ? { content: null, tool_calls: [{ id: 'lazy_1', type: 'function', function: { name: 'hold_payment', arguments: '{}' } }] } : { content: 'Stopping here.' };
  };
  const left = await buy({ claim: 'BR', walletId: wallet('BR'), model: lazy });
  line('Model stops after the hold', left);
  assert.equal(left.status, 'voided');
  assert.equal((await backend().getOrder(left.paypal.orderId!)).authorizationStatus, 'VOIDED');

  // 8. PayPal fails in the middle of taking a payment: nothing is shown as paid.
  fake.failNext('captureAuthorization', 'INTERNAL_SERVICE_ERROR: try again later.');
  const failed = await buy({ claim: 'JP', walletId: wallet('JP') });
  line('PayPal error during capture', failed);
  assert.equal(failed.status, 'voided');
  assert.equal(failed.paypal.captureId, undefined);

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
  fake.approve(viaAgent.paypal.orderId!, wallet('US'));
  await runSettlement(viaAgent.id, llm);
  const seen = await tool('get_purchase', { purchase_id: checkout.purchase_id });
  line('AI agent over MCP, US wallet', viaAgent);
  assert.equal(seen.status, 'voided');
  assert.equal(seen.price_for_the_wallets_country.country, 'US');
  assert.equal(seen.viaAgent, true);

  // 10. The seller refunds a sale; the gift that came with it leaves the pool.
  const refunded = await refundSale(ingrid.id);
  assert(typeof refunded !== 'string', String(refunded));
  assert.equal(refunded.status, 'refunded');
  assert.equal(await refundSale(ingrid.id), 'Only a captured payment can be refunded.');

  // Nothing above took money from a wallet outside the quoted country.
  for (const s of sales()) if (s.status === 'captured' || s.status === 'refunded') assert.equal(s.walletCountry, s.quotedCountry, `${s.id} was captured across countries`);
  console.log(`  ledger: ${sales().length} sales, ${sales().filter((s) => s.status === 'captured').length} captured, ${sales().filter((s) => s.status === 'voided').length} released, pool $${store.pool.balance}`);
  console.log('E2E PASSED');
}

main().catch((e) => {
  console.error('E2E FAILED');
  console.error(e);
  process.exit(1);
});
