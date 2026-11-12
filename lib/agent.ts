// The model client and the tool loop shared by the three agents (errand, host, till).
import OpenAI from 'openai';
import { isScripted } from './shops';
import { store } from './store';
import type { Event, ToolResult, Treat } from './types';

// ---- model client (OpenAI-compatible chat completions; injectable for tests) ----

export interface LlmTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface LlmCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface LlmReply {
  content: string | null;
  tool_calls?: LlmCall[];
}
export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | ({ role: 'assistant' } & LlmReply)
  | { role: 'tool'; tool_call_id: string; content: string };
export type Llm = (messages: LlmMessage[], tools: LlmTool[]) => Promise<LlmReply>;

let client: OpenAI | undefined;
let standIn: Llm | undefined;
export const defaultLlm: Llm = async (messages, tools) => {
  if (isScripted()) {
    standIn ??= (await import('./llm-scripted')).scripted();
    return standIn(messages, tools);
  }
  if (!process.env.OPENAI_API_KEY || !process.env.LLM_MODEL) {
    throw new Error('No language model is configured. Set OPENAI_API_KEY and LLM_MODEL.');
  }
  // A stalled model call must not leave a payment hanging: one minute, one retry.
  client ??= new OpenAI({ baseURL: process.env.OPENAI_BASE_URL || undefined, timeout: 60_000, maxRetries: 1 });
  const res = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    messages: messages as never,
    ...(tools.length ? { tools } : {}),
  });
  const m = res.choices[0].message;
  return { content: m.content, tool_calls: m.tool_calls as LlmCall[] | undefined };
};

export const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): LlmTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export type Handlers = Record<string, (args: Record<string, unknown>) => Promise<ToolResult>>;
export const ok = (data: unknown): ToolResult => ({ ok: true, data });
export const refuse = (t: Treat, error: string): ToolResult => {
  store.emit(t.id, { actor: 'rules', type: 'refused', summary: `Refused: ${error}` });
  return { ok: false, refused: true, error };
};
export const str = (v: unknown, max: number): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().slice(0, max);

/**
 * Runs the model with tools until `done()` or it stops calling tools. Returns the last text it wrote.
 * With `narrate`, what the model says between steps is added to the treat's activity log.
 */
export async function loop(o: {
  treat: Treat;
  actor: Event['actor'];
  system: string;
  user: unknown;
  tools: LlmTool[];
  handlers: Handlers;
  llm: Llm;
  done?: () => boolean;
  maxTurns: number;
  narrate?: boolean;
}): Promise<string> {
  const { treat: t, handlers, llm, tools } = o;
  const messages: LlmMessage[] = [
    { role: 'system', content: o.system },
    { role: 'user', content: JSON.stringify(o.user) },
  ];
  let last = '';
  for (let turn = 0; turn < o.maxTurns && !o.done?.(); turn++) {
    const reply = await llm(messages, tools);
    const calls = reply.tool_calls ?? [];
    const said = reply.content?.trim() ?? '';
    // A reply with neither text nor tool calls is not sent back: providers reject an empty assistant message.
    if (calls.length || said) messages.push({ role: 'assistant', content: reply.content, ...(calls.length ? { tool_calls: calls } : {}) });
    if (said) {
      last = said;
      if (o.narrate) store.emit(t.id, { actor: o.actor, type: 'note', summary: said });
    }
    if (!calls.length) break;
    // One at a time, in the order the model gave: these are steps of one errand or one payment, not independent lookups.
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.function.arguments || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
      } catch {
        /* malformed arguments are treated as empty; the tool says what is missing */
      }
      const handler = handlers[call.function.name];
      let result: ToolResult;
      try {
        result = handler ? await handler(args) : { ok: false, refused: true, error: `There is no tool ${call.function.name}.` };
      } catch (e) {
        result = { ok: false, refused: false, error: (e as Error).message };
        store.emit(t.id, { actor: 'desk', type: 'error', summary: `PayPal said: ${(e as Error).message}` });
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return last;
}

export const PLAIN = 'Short, plain sentences. No sales talk, no flattery, no emoji, no exclamation marks.';
