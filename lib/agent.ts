// The model client and the tool loop shared by the three agents (errand, host, till).
// Two providers: the Claude API through Anthropic's SDK (ANTHROPIC_API_KEY), or any OpenAI-compatible chat
// completions endpoint (OPENAI_API_KEY). The agents do not know which one answers.
import Anthropic from '@anthropic-ai/sdk';
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
  /** The provider's own form of this turn (thinking blocks included), sent back unchanged on the next request. */
  raw?: unknown;
}
export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | ({ role: 'assistant' } & LlmReply)
  | { role: 'tool'; tool_call_id: string; content: string };
export type Llm = (messages: LlmMessage[], tools: LlmTool[]) => Promise<LlmReply>;

/** Tokens used since this process started, for working out what a treat costs to run. */
export const usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

let claude: Anthropic | undefined;
/** The cheapest current Claude model. The agents only look things up, choose and write; every amount is decided in code. */
const CLAUDE_MODEL = 'claude-haiku-5-5';

const claudeLlm: Llm = async (messages, tools) => {
  claude ??= new Anthropic({ timeout: 60_000, maxRetries: 1 }); // reads ANTHROPIC_API_KEY
  const [first, ...rest] = messages;
  const turns: Anthropic.MessageParam[] = [];
  for (const m of first.role === 'system' ? rest : messages) {
    if (m.role === 'user') turns.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      // The turn goes back exactly as the model produced it: its thinking blocks are only valid unchanged.
      const blocks = (m.raw as Anthropic.ContentBlockParam[] | undefined) ?? [
        ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
        ...(m.tool_calls ?? []).map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || '{}') })),
      ];
      turns.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      // Every result of one turn goes back in a single user message.
      const result: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      const last = turns.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) last.content.push(result);
      else turns.push({ role: 'user', content: [result] });
    }
  }
  const res = await claude.messages.create({
    model: process.env.LLM_MODEL || CLAUDE_MODEL,
    max_tokens: 16000,
    // The instructions and tool list are the same on every call, so they are cached and re-read at a tenth of the price.
    ...(first.role === 'system' ? { system: [{ type: 'text' as const, text: first.content, cache_control: { type: 'ephemeral' as const } }] } : {}),
    // In a tool loop each call repeats everything before it: cache that too.
    ...(tools.length ? { cache_control: { type: 'ephemeral' as const } } : {}),
    thinking: { type: 'adaptive' },
    // Short lookups and short replies: low effort keeps thinking, and its cost, small.
    output_config: { effort: (process.env.LLM_EFFORT as 'low' | 'medium' | 'high' | undefined) || 'low' },
    ...(tools.length ? { tools: tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters as Anthropic.Tool.InputSchema })) } : {}),
    messages: turns,
  });
  usage.calls++;
  usage.input += res.usage.input_tokens;
  usage.output += res.usage.output_tokens;
  usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
  usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request.');
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
  const calls = res.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }] : []));
  return { content: text || null, ...(calls.length ? { tool_calls: calls } : {}), raw: res.content };
};

let client: OpenAI | undefined;
/** The cheapest current OpenAI model with tool calling; the same price as the Claude default. */
const OPENAI_MODEL = 'gpt-6-luna';
/** Which model answers, for display and for working out cost. */
export const modelName = (): string => (isScripted() ? 'scripted stand-in' : process.env.LLM_MODEL || (process.env.ANTHROPIC_API_KEY ? CLAUDE_MODEL : OPENAI_MODEL));
let standIn: Llm | undefined;
export const defaultLlm: Llm = async (messages, tools) => {
  if (isScripted()) {
    standIn ??= (await import('./llm-scripted')).scripted();
    return standIn(messages, tools);
  }
  if (process.env.ANTHROPIC_API_KEY) return claudeLlm(messages, tools);
  if (!process.env.OPENAI_API_KEY) throw new Error('No language model is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
  // A stalled model call must not leave a payment hanging: one minute, one retry.
  client ??= new OpenAI({ baseURL: process.env.OPENAI_BASE_URL || undefined, timeout: 60_000, maxRetries: 1 });
  const res = await client.chat.completions.create({
    model: process.env.LLM_MODEL || OPENAI_MODEL,
    messages: messages.map((m) => (m.role === 'assistant' ? { role: m.role, content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) } : m)) as never,
    ...(tools.length ? { tools } : {}),
  });
  usage.calls++;
  usage.input += res.usage?.prompt_tokens ?? 0;
  usage.output += res.usage?.completion_tokens ?? 0;
  usage.cacheRead += res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
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
    if (calls.length || said) messages.push({ role: 'assistant', content: reply.content, ...(calls.length ? { tool_calls: calls } : {}), ...(reply.raw ? { raw: reply.raw } : {}) });
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
