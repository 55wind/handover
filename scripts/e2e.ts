// End-to-end check of the whole flow, in-process.
// Uses the real model when OPENAI_API_KEY and LLM_MODEL are set (E2E_SCRIPTED=1 forces the scripted stand-in),
// and the real PayPal sandbox when PAYPAL_1_CLIENT_ID is set; otherwise the in-memory fake.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (!process.env.PAYPAL_1_CLIENT_ID) process.env.PAYPAL_FAKE = '1';
const scriptedModel = process.env.E2E_SCRIPTED === '1' || !process.env.OPENAI_API_KEY || !process.env.LLM_MODEL;

import type { Case } from '../lib/types';

async function main() {
  const { runPhase } = await import('../lib/agent');
  const { seedDemoCase } = await import('../lib/seed');
  const { store } = await import('../lib/store');
  const { isFake } = await import('../lib/merchants');
  const { toCents } = await import('../lib/guard');
  const { scripted } = await import('../lib/llm-scripted');
  const llm = scriptedModel ? scripted() : undefined;
  console.log(`model: ${scriptedModel ? 'scripted stand-in' : process.env.LLM_MODEL}   paypal: ${isFake() ? 'in-memory fake' : 'sandbox'}`);

  const byLabel = (c: Case, merchant: string, label: RegExp) => {
    const item = c.items.find((i) => i.merchant === merchant && label.test(i.label));
    assert(item, `missing item ${merchant} ${label}`);
    return item;
  };
  const errors = (c: Case) => c.events.filter((e) => e.type === 'error').map((e) => e.summary);

  // ---- run 1: pause, resume, then the full settlement ----
  const c = await seedDemoCase();
  console.log(`case ${c.id}: seeded`);

  const noticeText = c.document.text;
  c.document.text = undefined; // no document: the case must stay "filed" and only allow reversible steps
  await runPhase(c.id, 'intake', llm);
  assert.deepEqual(errors(c), []);
  assert.equal(c.tier, 'filed');
  assert.equal(c.status, 'review');
  await runPhase(c.id, 'pause', llm);
  assert.equal(c.paused, true, 'pause should suspend subscriptions');
  assert(c.items.filter((i) => i.kind === 'subscription').every((i) => i.liveStatus === 'SUSPENDED'));
  await runPhase(c.id, 'resume', llm);
  assert.equal(c.paused, false, 'resume should undo the pause');
  assert(c.items.filter((i) => i.kind === 'subscription').every((i) => i.liveStatus === 'ACTIVE'));
  console.log('pause and resume: ok');

  c.document.text = noticeText;
  await runPhase(c.id, 'intake', llm);
  assert.deepEqual(errors(c), []);
  assert.equal(c.tier, 'verified', c.document.mismatches.join(' '));
  assert.equal(c.items.length, 5, 'five items across three merchants');
  assert(c.items.every((i) => i.proposed && i.decided), 'every item has a proposal');
  assert(c.notes.some((n) => /Daniela Reyes/.test(n)), 'the near match is reported');
  console.log('intake and plan: ok');
  for (const i of c.items) console.log(`  ${i.merchant.padEnd(12)} ${i.label.padEnd(42)} ${i.decided!.action.padEnd(16)} refund ${i.decided!.refunds.map((r) => r.amount).join('+') || '-'}`);

  c.approvedAt = new Date().toISOString();
  await runPhase(c.id, 'execute', llm);
  assert.deepEqual(errors(c), []);
  assert.equal(c.status, 'done');
  assert(c.items.every((i) => i.outcome), 'every item has an outcome');
  for (const i of c.items) console.log(`  ${i.merchant.padEnd(12)} ${i.label.padEnd(42)} ${i.outcome!.state.padEnd(10)} verified=${i.outcome!.verified} ${i.liveStatus}`);
  assert(c.items.every((i) => i.outcome!.state !== 'done' || i.outcome!.verified), 'nothing is done without PayPal confirming it');
  for (const item of c.items) {
    for (const ch of item.charges) {
      assert((store.refunded.get(ch.captureId) ?? 0) <= toCents(ch.refundable), `refund above bound on ${ch.captureId}`);
    }
  }
  const locker = byLabel(c, 'ironwood', /locker/i);
  assert.equal(store.refunded.get(locker.paypalId), toCents(locker.charges[0].refundable), 'locker refund equals the computed amount');
  if (scriptedModel) {
    for (const [merchant, label] of [['lumen', /family/i], ['harborlight', /gift/i]] as const) {
      const item = byLabel(c, merchant, label);
      assert.equal(item.outcome!.state, 'waiting');
      assert(item.outcome!.link, 'take-over shows an approval link');
      assert.equal(item.liveStatus, 'SUSPENDED');
    }
    assert.equal(byLabel(c, 'ironwood', /membership/i).liveStatus, 'CANCELLED');
    assert.equal(byLabel(c, 'ironwood', /training/i).liveStatus, 'CANCELLED');
    assert.equal(store.refunded.get(byLabel(c, 'lumen', /family/i).charges[1].captureId), 1799);
  }
  assert(c.statement?.includes('Total refunded'), 'closing statement exists');
  console.log('execute: ok');

  // ---- the family member approves one take-over at PayPal ----
  if (isFake() && scriptedModel) {
    const { finalizeTakeOvers } = await import('../lib/agent');
    const { approveSubscription } = await import('../lib/paypal-fake');
    const lumen = byLabel(c, 'lumen', /family/i);
    await finalizeTakeOvers(c.id);
    assert.equal(lumen.outcome!.state, 'waiting', 'nothing changes before the approval');
    assert(approveSubscription(lumen.refs.newSubscriptionId));
    await finalizeTakeOvers(c.id);
    assert.equal(lumen.outcome!.state, 'done');
    assert.equal(lumen.outcome!.verified, true);
    assert.equal(lumen.liveStatus, 'CANCELLED');
    assert.equal(byLabel(c, 'harborlight', /gift/i).outcome!.state, 'waiting', 'the other take-over still waits');
    assert(c.statement?.includes('taken over; the new subscription is approved'));
    console.log('take-over approval: ok');
  }
  console.log(c.statement);

  // ---- run 2: a PayPal failure mid-execution blocks one row and the rest still finish ----
  if (isFake() && scriptedModel) {
    const { failNext } = await import('../lib/paypal-fake');
    const c2 = await seedDemoCase();
    await runPhase(c2.id, 'intake', llm);
    c2.approvedAt = new Date().toISOString();
    failNext('create_refund', 'INSTRUMENT_DECLINED: the refund could not be processed.');
    await runPhase(c2.id, 'execute', llm);
    const blocked = c2.items.filter((i) => i.outcome!.state !== 'done' && i.outcome!.state !== 'waiting');
    assert.equal(blocked.length, 1, `exactly one row should be blocked, got ${blocked.map((i) => `${i.label}:${i.outcome!.state}`).join(', ')}`);
    assert.equal(blocked[0].outcome!.verified, false);
    assert.equal(c2.status, 'done');
    console.log(`injected failure: ok (${blocked[0].label} is ${blocked[0].outcome!.state})`);
  }
  console.log('E2E PASSED');
}

main().catch((e) => {
  console.error('E2E FAILED');
  console.error(e);
  process.exit(1);
});
