// One whole treat against the real PayPal sandbox, in-process: a sender's sentence, a real order, a real hold after a
// person approves it, a change by the recipient, a real partial capture at the counter and a real payout to the shop.
// The model is the real one when OPENAI_API_KEY and LLM_MODEL are set, otherwise the scripted stand-in (said in the output).
// Usage: npx tsx scripts/sandbox-run.ts   then open the printed link, log in as a sandbox buyer and approve.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
delete process.env.PAYPAL_FAKE;
const scriptedModel = process.env.SANDBOX_SCRIPTED === '1' || !process.env.LLM_MODEL;
if (scriptedModel) process.env.LLM_SCRIPTED = '1';

async function main() {
  const { runErrand } = await import('../lib/errand');
  const { runHost } = await import('../lib/host');
  const { redeem, recheck } = await import('../lib/till');
  const { newTreat, startCheckout, placeHold, recipientView } = await import('../lib/treats');
  const { backend } = await import('../lib/paypal');
  const say = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${s}`);
  say(`model: ${scriptedModel ? 'scripted stand-in' : process.env.LLM_MODEL}   paypal: real sandbox`);

  const t = newTreat({ name: 'Ji-woo', language: 'en' });
  assert(typeof t !== 'string', String(t));
  await runErrand(t.id, process.argv[2] ?? 'My mom in Haeundae, Busan has a cold. Get her something warm tonight.');
  say(`agent: ${t.errand.at(-1)?.text}`);
  assert(t.shopId && t.itemId && t.price && t.ceiling, 'the agent proposed a treat');
  const started = await startCheckout(t);
  assert(typeof started !== 'string', String(started));
  say(`order ${t.paypal.orderId} asks to hold $${t.ceiling}. APPROVE HERE: ${started.approveUrl}`);

  const deadline = Date.now() + 6 * 60_000;
  while (!(await placeHold(t.id))) {
    if (Date.now() > deadline) throw new Error('nobody approved the order in six minutes');
    await new Promise((r) => setTimeout(r, 4000));
  }
  say(`held: authorisation ${t.paypal.authorizationId}, good until ${t.expiresAt}`);
  await runHost(t.id, { greet: true });
  say(`host: ${t.host.at(-1)?.text}`);
  await runHost(t.id, { text: "I can't eat seafood." });
  say(`host: ${t.host.at(-1)?.text}   (now ${t.itemId}, $${t.price})`);
  assert(!JSON.stringify(recipientView(t)).includes(t.price!), 'the recipient sees no amount');

  const served = await redeem(t.shopId!, t.code);
  say(`counter: ${typeof served === 'string' ? served : JSON.stringify(served.served)}`);
  assert(typeof served !== 'string', String(served));
  const order = await backend().getOrder(t.paypal.orderId!);
  say(`PayPal: held $${order.amount}, captured $${order.capturedAmount} (${order.captureStatus}), authorisation ${order.authorizationStatus}`);
  assert.equal(order.capturedAmount, t.price);
  assert.equal(order.authorizationStatus, 'CAPTURED');
  say(`payout ${t.paypal.payoutId ?? '(none)'}: ${t.paypal.payoutStatus}`);
  await new Promise((r) => setTimeout(r, 8000));
  await recheck(t, 0);
  say(`payout after a moment: ${t.paypal.payoutStatus}`);
  say(`sender is told: ${t.outcome?.forSender}  charged $${t.outcome?.charged}, released $${t.outcome?.released}, confirmed ${t.outcome?.verified}`);
  for (const e of t.events) console.log(`    [${e.actor}/${e.type}] ${e.summary}`);
  console.log('SANDBOX RUN PASSED');
}

main().catch((e) => {
  console.error('SANDBOX RUN FAILED');
  console.error(e);
  process.exit(1);
});
