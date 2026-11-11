// End-to-end check of the whole flow, in-process.
// Uses the real model when OPENAI_API_KEY and LLM_MODEL are set (E2E_SCRIPTED=1 forces the scripted stand-in),
// and the real PayPal sandbox when PAYPAL_1_CLIENT_ID is set; otherwise the in-memory fake.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (!process.env.PAYPAL_1_CLIENT_ID) process.env.PAYPAL_FAKE = '1';
const scriptedModel = process.env.E2E_SCRIPTED === '1' || !process.env.OPENAI_API_KEY || !process.env.LLM_MODEL;

import type { Llm, LlmCall, LlmMessage } from '../lib/agent';
import type { Case } from '../lib/types';

/** A fixed policy standing in for the model, so the loop, desks and guard can be checked without an LLM key. */
function scripted(): Llm {
  let n = 0;
  const owner = new Map<string, string>(); // tool call id -> item id
  const call = (name: string, args: unknown, itemId?: string): LlmCall => {
    const id = `call_${++n}`;
    if (itemId) owner.set(id, itemId);
    return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
  };
  const turnsOf = (m: LlmMessage[]) => m.filter((x) => x.role === 'assistant').length;
  const toolResults = (m: LlmMessage[]) => m.filter((x): x is Extract<LlmMessage, { role: 'tool' }> => x.role === 'tool');
  const slugs = ['lumen', 'ironwood', 'harborlight'];

  return async (messages, tools) => {
    const names = new Set(tools.map((t) => t.function.name));
    const turn = turnsOf(messages);

    if (!tools.length) {
      const text = JSON.stringify(messages[1].content);
      const name = /\\n([^\\]+?) of Portland/.exec(text)?.[1] ?? null;
      const date = /died peacefully on ([A-Za-z]+ \d{1,2}, \d{4})/.exec(text)?.[1];
      return { content: JSON.stringify({ full_name: name, date_of_death: date ? new Date(`${date} UTC`).toISOString().slice(0, 10) : null, kind: 'funeral home notice' }) };
    }

    if (names.has('submit_plan')) {
      if (turn === 0) {
        return { content: 'Asking each merchant what they hold.', tool_calls: slugs.flatMap((s) => [call(`${s}__find_customer_records`, {}), call(`${s}__get_policy`, {})]) };
      }
      const rows: unknown[] = [];
      for (const r of toolResults(messages)) {
        const data = JSON.parse(r.content)?.data;
        for (const customer of data?.customers ?? []) {
          for (const item of customer.items) {
            const refundable = item.charges.filter((ch: { refundable: string }) => Number(ch.refundable) > 0).map((ch: { capture_id: string }) => ch.capture_id);
            const merchant = String(item.item_id).split('-')[0];
            if (item.kind === 'subscription') {
              const keep = merchant !== 'ironwood';
              const gift = merchant === 'harborlight';
              rows.push({
                item_id: item.item_id,
                action: keep ? 'take_over' : 'close',
                refund_capture_ids: gift ? [] : refundable,
                reason: keep ? 'The family wants to keep this and the policy allows a take-over.' : 'The family asked to close everything else.',
                ...(gift && refundable.length ? { question: 'A gift was taken after the date of death. Would you like it returned?' } : {}),
              });
            } else if (item.kind === 'charge') {
              rows.push({ item_id: item.item_id, action: refundable.length ? 'refund' : 'leave', refund_capture_ids: refundable, reason: 'The unused part is refundable under the policy.' });
            } else {
              rows.push({ item_id: item.item_id, action: 'waive', refund_capture_ids: [], reason: 'The sessions were never taken and the policy waives such invoices.' });
            }
          }
        }
      }
      return { content: 'Submitting the plan.', tool_calls: [call('submit_plan', { rows })] };
    }

    if (names.has('record_outcome')) {
      type Row = { item_id: string; merchant: string; kind: string; paypal_id: string; plan_id?: string; action: string; refunds: { capture_id: string }[] };
      const planRows = (JSON.parse(String(messages[1].content)).plan as Row[]) ?? [];
      const refunds = (p: Row) => p.refunds.map((r) => call(`${p.merchant}__create_refund`, { capture_id: r.capture_id, note_to_payer: 'Refund after a death was reported.' }, p.item_id));
      if (turn === 0) {
        return {
          content: 'Starting with refunds, replacement subscriptions and reminders.',
          tool_calls: planRows.flatMap((p) =>
            p.action === 'close' || p.action === 'refund'
              ? refunds(p)
              : p.action === 'take_over'
                ? [call(`${p.merchant}__create_subscription`, { plan_id: p.plan_id }, p.item_id), ...refunds(p)]
                : p.action === 'waive' || p.action === 'pay_from_estate'
                  ? [call(`${p.merchant}__cancel_invoice_auto_reminder`, { invoice_id: p.paypal_id }, p.item_id)]
                  : p.action === 'pause'
                    ? [call(`${p.merchant}__suspend_subscription`, { subscription_id: p.paypal_id, reason: 'Paused by family.' }, p.item_id)]
                    : [],
          ),
        };
      }
      if (turn === 1) {
        const second = planRows.flatMap((p) =>
          p.action === 'close'
            ? [call(`${p.merchant}__cancel_subscription`, { subscription_id: p.paypal_id, payload: { reason: 'Account holder deceased.' } }, p.item_id)]
            : p.action === 'take_over'
              ? [call(`${p.merchant}__suspend_subscription`, { subscription_id: p.paypal_id, reason: 'Being taken over by family.' }, p.item_id)]
              : p.action === 'waive'
                ? [call(`${p.merchant}__cancel_sent_invoice`, { invoice_id: p.paypal_id, note: 'Waived after a death was reported.' }, p.item_id)]
                : p.action === 'pay_from_estate'
                  ? [call(`${p.merchant}__generate_invoice_qr_code`, { invoice_id: p.paypal_id }, p.item_id)]
                  : [],
        );
        if (second.length) return { content: 'Closing, pausing and cancelling.', tool_calls: second };
      }
      if (turn <= 2 && !messages.some((m) => m.role === 'assistant' && m.tool_calls?.some((t) => t.function.name === 'record_outcome'))) {
        const failed = new Set<string>();
        for (const r of toolResults(messages)) {
          const result = JSON.parse(r.content);
          // A missing reminder is not a failure of the item.
          const callName = messages.flatMap((m) => (m.role === 'assistant' ? (m.tool_calls ?? []) : [])).find((t) => t.id === r.tool_call_id)?.function.name ?? '';
          if (result?.ok === false && !callName.endsWith('cancel_invoice_auto_reminder')) failed.add(owner.get(r.tool_call_id) ?? '');
        }
        return {
          content: 'Recording outcomes.',
          tool_calls: planRows.map((p) =>
            call('record_outcome', { item_id: p.item_id, state: failed.has(p.item_id) ? 'blocked' : 'done', note: failed.has(p.item_id) ? 'A step was refused. Please contact the merchant.' : 'Completed as approved.' }),
          ),
        };
      }
      return { content: null, tool_calls: [call('finish', { note: 'Everything you approved has been carried out. Two take-overs are waiting for your approval in PayPal.' })] };
    }

    // pause or resume
    if (turn === 0) {
      const subs = JSON.parse(String(messages[1].content)).subscriptions as { merchant: string; subscription_id: string; status: string }[];
      const pausing = names.has('lumen__suspend_subscription');
      const calls = subs
        .filter((s) => s.status === (pausing ? 'ACTIVE' : 'SUSPENDED'))
        .map((s) => call(`${s.merchant}__${pausing ? 'suspend' : 'activate'}_subscription`, { subscription_id: s.subscription_id, reason: 'Handover e2e.' }));
      if (calls.length) return { content: pausing ? 'Pausing.' : 'Resuming.', tool_calls: calls };
    }
    return { content: null, tool_calls: [call('finish', { note: 'Done.' })] };
  };
}

async function main() {
  const { runPhase } = await import('../lib/agent');
  const { seedDemoCase } = await import('../lib/seed');
  const { store } = await import('../lib/store');
  const { isFake } = await import('../lib/merchants');
  const { toCents } = await import('../lib/guard');
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
