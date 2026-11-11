import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PAYPAL_FAKE = '1';
process.env.LLM_SCRIPTED = '1';

let n = 0;
async function rpc(method: string, params?: unknown) {
  const { handleRpc } = await import('./mcp');
  return (await handleRpc({ jsonrpc: '2.0', id: ++n, method, params: params as never })) as {
    result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[]; protocolVersion?: string };
    error?: { code: number };
  };
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r.result!.content![0].text;
  return { isError: !!r.result!.isError, text, data: r.result!.isError ? null : JSON.parse(text) };
}

test('mcp: initialize, list, and the protocol edges', async () => {
  const { handleRpc } = await import('./mcp');
  assert.equal((await rpc('initialize', { protocolVersion: '2025-03-26' })).result!.protocolVersion, '2025-03-26');
  assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).result!.protocolVersion, '2025-06-18');
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await rpc('nope')).error!.code, -32601);
  assert.equal((await rpc('tools/call', { name: 'nope' })).error!.code, -32602);
  const names = (await rpc('tools/list')).result!.tools!.map((t) => t.name);
  assert.deepEqual(names, ['start_demo_case', 'file_notice', 'get_case', 'change_decision', 'approve_and_carry_out', 'pause_everything', 'resume_everything', 'check_take_over_approval']);
});

test('mcp: an assistant can take a case from notice to closing statement', async () => {
  const started = await call('start_demo_case');
  const id = started.data.case_id as string;
  assert.equal(started.data.status, 'notice');

  // Nothing irreversible before the family approves a plan that exists.
  assert.match((await call('approve_and_carry_out', { case_id: id })).text, /matched|no plan/i);

  const planned = await call('file_notice', { case_id: id });
  assert.equal(planned.data.document_check, 'matched');
  assert.equal(planned.data.items.length, 5);

  const gym = planned.data.items.find((i: { label: string }) => i.label === 'Membership');
  const refused = await call('change_decision', { case_id: id, item_id: gym.item_id, action: 'take_over' });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /does not allow take-over/);

  const done = await call('approve_and_carry_out', { case_id: id });
  assert.equal(done.data.status, 'done');
  assert.match(done.data.closing_statement, /Total refunded: \$86\.65/);
  assert(done.data.items.every((i: { outcome: { confirmed_with_paypal: boolean } }) => i.outcome.confirmed_with_paypal));

  assert.match((await call('get_case', { case_id: 'missing' })).text, /no longer available/);
});

test('request bodies are read up to a limit and no further', async () => {
  const { readJson } = await import('./cases');
  const post = (body: string) => new Request('http://localhost/api/mcp', { method: 'POST', body });
  assert.deepEqual(await readJson(post('{"a":1}'), 100), { a: 1 });
  assert.equal(await readJson(post(`{"x":"${'a'.repeat(500)}"}`), 100), null);
  assert.equal(await readJson(post('not json'), 100), null);
});
