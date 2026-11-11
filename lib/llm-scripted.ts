// Development and tests only. A fixed policy that stands in for the language model so the clerk, the settlement
// loop and the UI can be exercised without an LLM key. Enabled in the server by LLM_SCRIPTED=1, which also shows
// the development banner. Never enable it on a hosted demo.
import type { Llm, LlmCall } from './agent';

export function scripted(): Llm {
  let n = 0;
  const call = (name: string, args: unknown = {}): LlmCall => ({ id: `call_${++n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });

  return async (messages, tools) => {
    // Lets a person watching the UI see each step arrive.
    await new Promise((r) => setTimeout(r, Number(process.env.LLM_SCRIPTED_DELAY ?? 0)));
    const names = new Set(tools.map((t) => t.function.name));
    const turn = messages.filter((m) => m.role === 'assistant').length;
    const results = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content) as { ok: boolean; error?: string; data?: Record<string, unknown> });
    const ctx = JSON.parse(String(messages[1].content));

    if (names.has('grant_help')) {
      const said = String(ctx.conversation.at(-1)?.text ?? '');
      const needs = /student|refugee|lost my job|unemployed|afford|supporting my family|scholarship/i.test(said);
      if (needs && turn === 0) return { content: null, tool_calls: [call('help_limit')] };
      if (needs && turn === 1) {
        const most = String(results.at(-1)?.data?.most_you_can_give ?? '0.00');
        return Number(most) > 0
          ? { content: null, tool_calls: [call('grant_help', { amount: most, reason: 'The buyer said their circumstances differ from their wallet country.' })] }
          : { content: `I would like to help, but I cannot right now. ${String(results.at(-1)?.data?.why ?? '')}` };
      }
      if (needs && turn === 2) {
        const r = results.at(-1);
        return { content: r?.ok ? `I have taken $${r.data?.help} off, from a pool other buyers paid into. You now pay $${r.data?.buyer_now_pays}.` : `I could not give help. ${r?.error ?? ''}` };
      }
      const q = ctx.quote;
      return {
        content: `This costs $${q.fair} for ${q.countryName}: about ${q.hoursAtFair} hours of average income there, against ${q.hoursAtList} hours at the list price of $${q.list}. The country is taken from your PayPal wallet when you pay.`,
      };
    }

    // settlement
    if (turn === 0) return { content: 'Asking PayPal about the order.', tool_calls: [call('read_order')] };
    const wallet = String(results[0]?.data?.wallet_country ?? '').toUpperCase();
    const match = wallet !== '' && wallet === ctx.quoted_country;
    if (turn === 1) {
      return match
        ? { content: 'The wallet is in the quoted country. Placing the hold.', tool_calls: [call('hold_payment')] }
        : { content: 'The wallet is not in the quoted country. Releasing.', tool_calls: [call('release_payment')] };
    }
    const taken = results.some((r) => r.ok && r.data?.captured);
    const refused = results.find((r) => !r.ok);
    if (match && turn === 2 && !refused) return { content: 'Taking the payment.', tool_calls: [call('take_payment')] };
    if (match && !taken && !results.some((r) => r.ok && r.data?.result)) return { content: 'That was refused. Releasing.', tool_calls: [call('release_payment')] };
    return {
      content: null,
      tool_calls: [
        call('finish', {
          message: taken
            ? `Paid. PayPal confirmed your wallet is registered in ${ctx.quoted_country_name}.`
            : refused && match
              ? `Nothing was taken. ${refused.error}`
              : `Nothing was taken. PayPal reports your wallet is registered in another country than ${ctx.quoted_country_name}, which this price was quoted for. You can buy at the price for your wallet's country.`,
        }),
      ],
    };
  };
}
